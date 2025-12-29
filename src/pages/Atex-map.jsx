// src/pages/Atex-map.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/atex-map.css";
import { api } from "../lib/api.js";
import { isMobileDevice, getPDFConfig, getNetworkQuality, getPlanCacheKey, getCachedPlan, cachePlan } from "../config/mobile-optimization.js";
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
  console[level](`[ATEX][${ts}] ${action}`, data);
}
function timeStart(label) {
  const id = `${label}#${Math.random().toString(36).slice(2, 7)}`;
  if (DEBUG()) {
    console.groupCollapsed(`⏱️ ${label} [start]`);
    console.time(id);
  }
  return () => {
    if (DEBUG()) {
      console.timeEnd(id);
      console.groupEnd();
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
/* ----------------------------- Id / headers ----------------------------- */
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
        if (!name && (u?.name || u?.displayName)) name = String(u.name || u?.displayName);
      } catch {}
    }
    // Check "eh_user" localStorage (Bubble login stores user data here)
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName)) name = String(x.name || x.displayName);
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
      className={`border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-200 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400 transition-all ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], placeholder, className = "" }) {
  return (
    <select
      className={`border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-200 focus:border-blue-500 bg-white text-gray-900 transition-all cursor-pointer ${className}`}
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
/* ----------------------------- Couleurs (Légende) ----------------------------- */
const GAS_STROKE = { 0: "#0ea5e9", 1: "#ef4444", 2: "#f59e0b", null: "#6b7280", undefined: "#6b7280" };
const DUST_FILL = { 20: "#84cc16", 21: "#8b5cf6", 22: "#06b6d4", null: "#e5e7eb", undefined: "#e5e7eb" };
const STATUS_COLOR = {
  a_faire: { fill: "#059669", border: "#34d399" },
  en_cours_30: { fill: "#f59e0b", border: "#fbbf24" },
  en_retard: { fill: "#e11d48", border: "#fb7185" },
  fait: { fill: "#2563eb", border: "#60a5fa" },
};
const ICON_PX = 22;
/* ----------------------- Helpers “taille réelle du plan” ---------------------- */
function getPlanDims(baseLayer) {
  if (!baseLayer?.getBounds) return null;
  const b = baseLayer.getBounds();
  const W = Math.max(1, b.getEast() - b.getWest());
  const H = Math.max(1, b.getNorth() - b.getSouth());
  return { W, H, bounds: b };
}
function toLatLngFrac(xf, yf, baseLayer) {
  const dims = getPlanDims(baseLayer);
  if (!dims) return L.latLng(0, 0);
  const { W, H, bounds: b } = dims;
  const lat = b.getSouth() + yf * H;
  const lng = b.getWest() + xf * W;
  return L.latLng(lat, lng);
}
function fromLatLngToFrac(latlng, baseLayer) {
  const dims = getPlanDims(baseLayer);
  if (!dims) return { xf: 0, yf: 0 };
  const { W, H, bounds: b } = dims;
  const xf = (latlng.lng - b.getWest()) / W;
  const yf = (latlng.lat - b.getSouth()) / H;
  return { xf: Math.min(1, Math.max(0, xf)), yf: Math.min(1, Math.max(0, yf)) };
}

// 🔥 DÉTECTION DE ZONE CÔTÉ FRONTEND (ne dépend plus du backend lent)
// ✅ FIX: Retourne la zone la plus PETITE contenant le point (plus spécifique)
function findContainingSubarea(xf, yf, subareas) {
  if (!subareas || typeof subareas !== 'object') return null;

  const list = Array.isArray(subareas) ? subareas : Object.values(subareas);

  // Collecter toutes les zones contenant le point avec leur aire
  const candidates = [];

  for (const sa of list) {
    if (!sa) continue;

    // Rectangle: vérifier si le point est dans le rectangle
    if (sa.kind === 'rect') {
      const x1 = Math.min(sa.x1 ?? 0, sa.x2 ?? 1);
      const x2 = Math.max(sa.x1 ?? 0, sa.x2 ?? 1);
      const y1 = Math.min(sa.y1 ?? 0, sa.y2 ?? 1);
      const y2 = Math.max(sa.y1 ?? 0, sa.y2 ?? 1);
      if (xf >= x1 && xf <= x2 && yf >= y1 && yf <= y2) {
        const area = (x2 - x1) * (y2 - y1);
        candidates.push({ sa, area });
      }
    }

    // Cercle: vérifier si le point est dans le cercle
    if (sa.kind === 'circle') {
      const cx = sa.cx ?? 0.5;
      const cy = sa.cy ?? 0.5;
      const r = sa.r ?? 0.1;
      const dist = Math.sqrt((xf - cx) ** 2 + (yf - cy) ** 2);
      if (dist <= r) {
        const area = Math.PI * r * r;
        candidates.push({ sa, area });
      }
    }

    // Polygone: ray casting algorithm
    if (sa.kind === 'poly' && Array.isArray(sa.points) && sa.points.length >= 3) {
      let inside = false;
      const pts = sa.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1];
        const xj = pts[j][0], yj = pts[j][1];
        if (((yi > yf) !== (yj > yf)) && (xf < (xj - xi) * (yf - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      if (inside) {
        // Calcul aire polygone (formule du lacet)
        let area = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
        }
        area = Math.abs(area / 2);
        candidates.push({ sa, area });
      }
    }
  }

  // ✅ Retourner la zone avec la plus petite aire (la plus spécifique)
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.area - b.area);
  return candidates[0].sa;
}

// 🔥 Nouveau design des marqueurs ATEX avec icône SVG et gradient (style Switchboard)
const ICON_PX_SELECTED = 34;  // 🆕 Plus grand pour meilleure visibilité

// Gradients par statut pour un design moderne
const STATUS_GRADIENT = {
  a_faire: { from: "#34d399", to: "#059669" },      // Vert emeraude
  en_cours_30: { from: "#fbbf24", to: "#f59e0b" },  // Ambre/Orange
  en_retard: { from: "#fb7185", to: "#e11d48" },    // Rose/Rouge
  fait: { from: "#60a5fa", to: "#2563eb" },         // Bleu
  selected: { from: "#a78bfa", to: "#7c3aed" },     // Violet pour sélection
  non_conforme: { from: "#ef4444", to: "#b91c1c" }, // Rouge vif pour non conforme
};

// Icône SVG flamme ATEX
const ATEX_FLAME_SVG = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/>
</svg>`;

function makeEquipIcon(status, isUnsaved, isSelected = false, complianceState = "na") {
  const s = isSelected ? ICON_PX_SELECTED : ICON_PX;

  // Marqueur non sauvegardé (nouveau)
  if (isUnsaved) {
    const html = `
      <div class="atex-marker-new${isSelected ? ' atex-marker-selected' : ''}" style="
        width:${s}px;height:${s}px;border-radius:9999px;
        background: radial-gradient(circle at 30% 30%, #93c5fd, #2563eb);
        border:2px solid white;
        box-shadow:0 4px 10px rgba(0,0,0,.25);
        display:flex;align-items:center;justify-content:center;
        transition:all 0.2s ease;
      ">
        ${ATEX_FLAME_SVG.replace('viewBox', `width="${s * 0.55}" height="${s * 0.55}" viewBox`)}
      </div>`;
    return L.divIcon({
      className: "atex-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }

  // Priorité: 1) Sélectionné = violet, 2) Non conforme = rouge, 3) Statut normal
  let grad;
  if (isSelected) {
    grad = STATUS_GRADIENT.selected;
  } else if (complianceState === "non_conforme") {
    grad = STATUS_GRADIENT.non_conforme;
  } else {
    grad = STATUS_GRADIENT[status] || STATUS_GRADIENT.fait;
  }

  // Classes d'animation - non conforme = pulsation rouge prioritaire
  let animClass = "";
  if (isSelected) {
    animClass = "atex-marker-selected";
  } else if (complianceState === "non_conforme") {
    animClass = "atex-marker-pulse-red"; // Rouge pulsant pour non conforme
  } else if (status === "en_retard") {
    animClass = "atex-marker-pulse-red";
  } else if (status === "en_cours_30") {
    animClass = "atex-marker-pulse-orange";
  }

  // 🆕 Bordure plus visible pour sélection
  const borderStyle = isSelected
    ? "border:3px solid #a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,0.4),0 6px 15px rgba(0,0,0,.35);"
    : "border:2px solid white;box-shadow:0 4px 10px rgba(0,0,0,.25);";

  const html = `
    <div class="${animClass}" style="
      width:${s}px;height:${s}px;border-radius:9999px;
      background: radial-gradient(circle at 30% 30%, ${grad.from}, ${grad.to});
      ${borderStyle}
      display:flex;align-items:center;justify-content:center;
      transition:all 0.2s ease;
      z-index:${isSelected ? 1000 : 1};
    ">
      ${ATEX_FLAME_SVG.replace('viewBox', `width="${s * 0.55}" height="${s * 0.55}" viewBox`)}
    </div>`;

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
/* ----------------------------- Formulaire SubArea ----------------------------- */
function SubAreaEditor({ initial = {}, onSave, onCancel, onStartGeomEdit, allowDelete, onDelete }) {
  const [name, setName] = useState(initial.name || "");
  const [gas, setGas] = useState(
    initial.zoning_gas === 0 || initial.zoning_gas === 1 || initial.zoning_gas === 2 ? String(initial.zoning_gas) : ""
  );
  const [dust, setDust] = useState(
    initial.zoning_dust === 20 || initial.zoning_dust === 21 || initial.zoning_dust === 22 ? String(initial.zoning_dust) : ""
  );
  return (
    <div className="rounded-2xl bg-white shadow-2xl w-[300px] overflow-hidden border border-gray-200 animate-slideUp">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-3">
        <div className="font-bold text-sm flex items-center gap-2">
          <span>⚠️</span> Zone ATEX
        </div>
        <div className="text-[11px] text-amber-100 mt-0.5">
          Bordure = Gaz • Remplissage = Poussière
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Nom */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Nom de la zone</label>
          <Input value={name} onChange={setName} placeholder="Ex: Mélangeur A" />
        </div>

        {/* Zonage */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
              Gaz
            </label>
            <Select
              value={gas}
              onChange={setGas}
              options={[
                { value: "", label: "Non classé" },
                { value: "0", label: "Zone 0" },
                { value: "1", label: "Zone 1" },
                { value: "2", label: "Zone 2" },
              ]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-400 inline-block"></span>
              Poussière
            </label>
            <Select
              value={dust}
              onChange={setDust}
              options={[
                { value: "", label: "Non classé" },
                { value: "20", label: "Zone 20" },
                { value: "21", label: "Zone 21" },
                { value: "22", label: "Zone 22" },
              ]}
            />
          </div>
        </div>

        {/* Preview des zones sélectionnées */}
        {(gas || dust) && (
          <div className="flex flex-wrap gap-2">
            {gas && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                💨 Gaz Zone {gas}
              </span>
            )}
            {dust && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
                🌫️ Poussière Zone {dust}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Btn variant="ghost" onClick={onCancel} className="text-xs">✕ Fermer</Btn>
          <div className="flex items-center gap-2">
            {!!onStartGeomEdit && (
              <Btn
                variant="subtle"
                className="text-xs"
                onClick={() => {
                  document.body.classList.add("editing-geom");
                  onStartGeomEdit();
                }}
              >
                ✏️ Forme
              </Btn>
            )}
            <Btn
              className="text-xs"
              onClick={() =>
                onSave?.({
                  name: name.trim(),
                  zoning_gas: gas === "" ? null : Number(gas),
                  zoning_dust: dust === "" ? null : Number(dust),
                })
              }
            >
              💾 Enregistrer
            </Btn>
          </div>
        </div>
        {allowDelete && (
          <Btn variant="danger" onClick={onDelete} className="w-full text-xs">
            🗑️ Supprimer cette zone
          </Btn>
        )}
      </div>
    </div>
  );
}
/* --------------------------------- LÉGENDE --------------------------------- */
function addLegendControl(map) {
  const ctrl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const el = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control p-2 bg-white rounded-xl border shadow atex-legend"
      );

      // ✅ Styles pour éviter que la légende soit rognée ou sorte du cadre
      el.style.maxWidth = "300px";
      el.style.marginBottom = "12px";
      el.style.marginRight = "12px";
      el.style.pointerEvents = "auto";
      el.style.overflowY = "auto";
      el.style.maxHeight = "220px";
      el.style.borderRadius = "0.75rem";
      el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";

      // ✅ Contenu de la légende avec les nouveaux marqueurs
      el.innerHTML = `
        <div class="text-xs font-semibold mb-2">Légende ATEX</div>

        <!-- Section Marqueurs avec nouveaux gradients -->
        <div class="text-[11px] text-gray-600 mb-2 font-medium">Équipements</div>
        <div class="flex flex-wrap items-center gap-3 mb-3 text-[11px]">
          <span class="inline-flex items-center gap-1">
            <span class="w-4 h-4 rounded-full flex items-center justify-center" style="background:radial-gradient(circle at 30% 30%, #34d399, #059669);">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="white"><path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/></svg>
            </span>
            À faire
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="w-4 h-4 rounded-full flex items-center justify-center" style="background:radial-gradient(circle at 30% 30%, #fbbf24, #f59e0b);">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="white"><path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/></svg>
            </span>
            ≤90j
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="w-4 h-4 rounded-full flex items-center justify-center" style="background:radial-gradient(circle at 30% 30%, #fb7185, #e11d48);">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="white"><path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/></svg>
            </span>
            En retard
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="w-4 h-4 rounded-full flex items-center justify-center" style="background:radial-gradient(circle at 30% 30%, #60a5fa, #2563eb);">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="white"><path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/></svg>
            </span>
            Fait
          </span>
        </div>

        <!-- Section Zones -->
        <div class="text-[11px] text-gray-600 mb-1 font-medium">Zones (Bordure=Gaz • Remplissage=Poussière)</div>
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div class="font-medium mb-1 text-gray-500">Gaz</div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-3 h-3 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[0]}"></span>
              Zone 0
            </div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-3 h-3 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[1]}"></span>
              Zone 1
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[2]}"></span>
              Zone 2
            </div>
          </div>
          <div>
            <div class="font-medium mb-1 text-gray-500">Poussière</div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-3 h-3 rounded-sm" style="background:${DUST_FILL[20]}"></span> Zone 20
            </div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-3 h-3 rounded-sm" style="background:${DUST_FILL[21]}"></span> Zone 21
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-sm" style="background:${DUST_FILL[22]}"></span> Zone 22
            </div>
          </div>
        </div>
      `;

      // ✅ Empêche les scrolls/clics de la légende d'impacter la carte
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
export default function AtexMap({
  plan,
  pageIndex = 0,
  onOpenEquipment,
  onZonesApplied,
  onMetaChanged,
  selectedEquipmentId = null,  // 🆕 Pour highlight équipement depuis liste
  inModal = true,
  autoOpenModal = true,
  title = "Plan ATEX",
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const subareasLayerRef = useRef(null);
  const legendRef = useRef(null);
  const roRef = useRef(null);
  // Tasks
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastJob = useRef({ key: null });
  // Flags
  const baseReadyRef = useRef(false);
  const indexedRef = useRef({ key: "", done: false });
  const draggingRef = useRef(false);
  const creatingEquipmentRef = useRef(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [unsavedIds] = useState(() => new Set());
  const [drawing, setDrawing] = useState(DRAW_NONE);
  const [polyTemp, setPolyTemp] = useState([]); // latlngs lors du dessin poly
  const [editorPos, setEditorPos] = useState(null);
  const [editorInit, setEditorInit] = useState({});
  const [legendVisible, setLegendVisible] = useState(false);  // 🆕 Caché par défaut
  const [zonesByEquip, setZonesByEquip] = useState(() => ({}));
  const [subareasById, setSubareasById] = useState(() => ({}));
  const [lastSubareaId, setLastSubareaId] = useState(null); // dernière zone créée
  const editHandlesLayerRef = useRef(null);
  const positionsRef = useRef([]);  // 🆕 Ref pour garder les positions localement
  const selectedEquipmentIdRef = useRef(selectedEquipmentId);  // 🆕 Ref pour highlight
  const [geomEdit, setGeomEdit] = useState({ active: false, kind: null, shapeId: null, layer: null });
  const [drawMenu, setDrawMenu] = useState(false);
  const drawMenuRef = useRef(null);
  const [open, setOpen] = useState(inModal ? !!autoOpenModal : true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const planKey = useMemo(() => plan?.id || plan?.logical_name || "", [plan]);
  const planDisplayName = useMemo(
    () => (plan?.display_name || plan?.logical_name || plan?.id || "").toString(),
    [plan]
  );
  // Métadonnées plan (Bâtiment / Zone) persistées par plan+page
  const [building, setBuilding] = useState("");
  const [zone, setZone] = useState("");
  const [savedBuilding, setSavedBuilding] = useState("");
  const [savedZone, setSavedZone] = useState("");

  // AJOUT : États nécessaires au rechargement après modification bâtiment/zone
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  const fileUrl = useMemo(() => {
    if (!plan) return null;
    if (api?.atexMaps?.planFileUrlAuto) return api.atexMaps.planFileUrlAuto(plan, { bust: true });
    if (api?.atexMaps?.planFileUrl) return api.atexMaps.planFileUrl(plan);
    return null;
  }, [plan]);

  // 🆕 Mise à jour selectedEquipmentId et re-dessin des marqueurs
  useEffect(() => {
    selectedEquipmentIdRef.current = selectedEquipmentId;
    // Re-dessiner les marqueurs avec le nouveau highlight
    if (baseReadyRef.current && positionsRef.current?.length > 0) {
      drawMarkers(positionsRef.current);
      // Si un équipement est sélectionné, centrer la carte dessus
      if (selectedEquipmentId) {
        const selectedPos = positionsRef.current.find(p => p.id === selectedEquipmentId);
        if (selectedPos && mapRef.current && baseLayerRef.current) {
          const base = baseLayerRef.current;
          const latlng = toLatLng(selectedPos.x, selectedPos.y, base);
          mapRef.current.setView(latlng, mapRef.current.getZoom(), { animate: true });
        }
      }
    }
  }, [selectedEquipmentId]);

  /* ------------------------------- Outside click menu ------------------------------- */
  useEffect(() => {
    if (!drawMenu) return;
    const onDocClick = (e) => {
      if (!drawMenuRef.current) return;
      if (!drawMenuRef.current.contains(e.target)) setDrawMenu(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDrawMenu(false);
        setDrawing(DRAW_NONE);
        if (polyTemp.length) setPolyTemp([]);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [drawMenu, polyTemp.length]);
  /* -------------------- Init carte (une fois) + rendu PDF -------------------- */
  useEffect(() => {
    if (!wrapRef.current || !open) return;

    const jobKey = `${fileUrl || "no-pdf"}::${pageIndex}`;

    // ✅ Correction : forcer rechargement si carte nettoyée ou couches absentes
    const mustForceReload =
      !baseReadyRef.current ||
      !mapRef.current ||
      !subareasLayerRef.current ||
      !markersLayerRef.current;

    if (lastJob.current.key === jobKey && !mustForceReload) return;
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
      baseReadyRef.current = false;
      indexedRef.current = { key: "", done: false };
    };

    let onResize = null;

    (async () => {
      setPdfLoading(true);
      const close = timeStart("init map + pdf render");
      try {
        await cleanupPdf();

        // 1️⃣ Création de la carte Leaflet
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

        // --- Pans et couches ---
        m.createPane("basePane"); m.getPane("basePane").style.zIndex = 200;
        m.createPane("zonesPane"); m.getPane("zonesPane").style.zIndex = 380;
        m.createPane("markersPane"); m.getPane("markersPane").style.zIndex = 400;
        m.createPane("editPane"); m.getPane("editPane").style.zIndex = 450;

        legendRef.current = addLegendControl(m);
        const legendEl = legendRef.current?.getContainer?.();
        if (legendEl) legendEl.style.display = legendVisible ? "block" : "none";

        markersLayerRef.current = L.layerGroup({ pane: "markersPane" }).addTo(m);
        subareasLayerRef.current = L.layerGroup({ pane: "zonesPane" }).addTo(m);
        editHandlesLayerRef.current = L.layerGroup({ pane: "editPane" }).addTo(m);

        // --- Bounds provisoires avant rendu PDF ---
        const PROV_W = 2000, PROV_H = 1400;
        const provBounds = L.latLngBounds([[0, 0], [PROV_H, PROV_W]]);
        await new Promise(requestAnimationFrame);
        m.invalidateSize(false);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        const fitZoom = m.getBoundsZoom(provBounds, true);
        m.setMinZoom(fitZoom - 2);
        m.setMaxZoom(fitZoom + 8);
        m.setMaxBounds(provBounds.pad(0.5));
        m.fitBounds(provBounds, { padding: [10, 10] });

        // --- Resize listeners ---
        onResize = () => {
          try {
            const keepCenter = m.getCenter();
            const keepZoom = m.getZoom();
            m.invalidateSize(false);
            m.setView(keepCenter, keepZoom, { animate: false });
          } catch {}
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        try {
          roRef.current = new ResizeObserver(() => { onResize(); });
          roRef.current.observe(wrapRef.current);
        } catch {}

        // 2️⃣ Rendu PDF -> image ULTRA HAUTE QUALITÉ pour plans détaillés
        if (fileUrl) {
          // Utiliser la taille d'ÉCRAN (pas conteneur) pour résolution maximale
          const screenW = Math.max(window.screen.width, window.innerWidth, 1920);
          const dpr = window.devicePixelRatio || 1;

          // 🚀 UTILISER LA CONFIG MOBILE-OPTIMIZATION (adaptée au réseau)
          const isMobile = isMobileDevice() || window.innerWidth < 768;
          const networkQuality = getNetworkQuality();
          const pdfConfig = getPDFConfig();

          // 🚀 CACHE: Vérifier si le plan est déjà rendu en cache
          const cacheKey = getPlanCacheKey(planKey || fileUrl, pageIndex, pdfConfig);
          const cached = getCachedPlan(cacheKey);

          let dataUrl, canvasW, canvasH;

          if (cached) {
            // ⚡ CACHE HIT - Utiliser les données en cache (instantané!)
            dataUrl = cached.dataUrl;
            canvasW = cached.width;
            canvasH = cached.height;
            console.log(`[ATEX] ⚡ Cache HIT - Plan affiché instantanément!`);
          } else {
            // 🔄 CACHE MISS - Rendre le PDF en ULTRA HAUTE RÉSOLUTION
            // Calculer la résolution cible basée sur l'écran (pas le conteneur)
            const targetBitmapW = Math.min(
              pdfConfig.maxBitmapWidth,
              Math.max(pdfConfig.minBitmapWidth, Math.floor(screenW * dpr * pdfConfig.qualityBoost))
            );

            loadingTaskRef.current = pdfjsLib.getDocument(pdfDocOpts(fileUrl));
            const pdf = await loadingTaskRef.current.promise;
            const page = await pdf.getPage(Number(pageIndex) + 1);
            const baseVp = page.getViewport({ scale: 1 });

            // Scale maximum pour qualité optimale
            const safeScale = Math.min(pdfConfig.maxScale, Math.max(pdfConfig.minScale, targetBitmapW / baseVp.width));
            const viewport = page.getViewport({ scale: safeScale });

            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);

            // Context optimisé pour qualité maximale
            const ctx = canvas.getContext("2d", {
              alpha: false,
              desynchronized: false,
              willReadFrequently: false,
            });

            // Fond blanc pour meilleur contraste
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Anti-aliasing haute qualité
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // 🔥 Rendu PDF avec intent "print" pour qualité maximale
            renderTaskRef.current = page.render({
              canvasContext: ctx,
              viewport,
              intent: 'print',  // "print" = meilleure qualité que "display"
              annotationMode: 2,
            });
            await renderTaskRef.current.promise;

            // 🚀 PNG PARTOUT = netteté parfaite (lossless, pas d'artefacts)
            // Le cache compense la taille plus importante
            dataUrl = canvas.toDataURL("image/png");
            canvasW = canvas.width;
            canvasH = canvas.height;

            // 💾 Stocker dans le cache pour les prochaines visites
            cachePlan(cacheKey, dataUrl, canvasW, canvasH);

            console.log(`[ATEX] PDF rendu: ${canvasW}x${canvasH}px (scale: ${safeScale.toFixed(2)}, target: ${targetBitmapW}px, intent: print, format: PNG)`);

            try { await pdf.cleanup?.(); } catch {}
          }

          setImgSize({ w: canvasW, h: canvasH });

          const bounds = L.latLngBounds([[0, 0], [canvasH, canvasW]]);
          const base = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1, pane: "basePane" }).addTo(m);
          baseLayerRef.current = base;

          await new Promise(requestAnimationFrame);
          m.invalidateSize(false);

          const fitZoom2 = m.getBoundsZoom(bounds, true);
          m.setMinZoom(fitZoom2 - 1);
          // Zoom max très élevé pour lire les plus petits détails
          m.setMaxZoom(fitZoom2 + (isMobile ? 6 : 8));
          m.setMaxBounds(bounds.pad(0.5));
          m.fitBounds(bounds, { padding: [8, 8] });

          // ✅ Marquer prêt IMMÉDIATEMENT (zones chargées en arrière-plan)
          baseReadyRef.current = true;
          setPdfLoading(false); // Fermer le loader tout de suite

          // 🚀 Charger les données en arrière-plan (non-bloquant)
          reloadAll().catch(console.error);
        }
      } catch (e) {
        console.error("[AtexMap] init error", e);
      } finally {
        close();
        setPdfLoading(false);
      }
    })();

    return () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { loadingTaskRef.current?.destroy?.(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
      cleanupMap();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, pageIndex, open]);
  /* ----------------------------- Chargements ----------------------------- */
  // ✅ reindexZones supprimé - la détection de zones se fait côté frontend (findContainingSubarea)
  // et setPosition met à jour les zones en arrière-plan côté backend
  async function reloadAll() {
    if (!baseReadyRef.current || !planKey) return;

    // 🚀 Charger positions IMMÉDIATEMENT (critique pour l'affichage)
    loadPositions().catch(console.error);

    // 🚀 Charger sous-zones en arrière-plan (non-bloquant)
    setTimeout(() => {
      loadSubareas().catch(console.error);
    }, 100);
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

  // AJOUT ICI : Nouvelle fonction de rechargement
  async function reloadPlanData() {
    if (!planKey) return;

    setLoading?.(true);
    try {
      // 1. Recharger les positions (marqueurs)
      const pos = await api.atexMaps.positionsAuto(planKey, pageIndex);
      setPositions(pos?.items || []);

      // 2. Recharger toutes les fiches équipements du plan
      const eqs = await api.atex.listEquipments({ plan: planKey });
      setEquipments(eqs?.items || []);

      // 3. Forcer le remontage Leaflet
      setMapRefreshTick?.((t) => t + 1);
    } catch (e) {
      console.error("[ATEX] reloadPlanData error", e);
    } finally {
      setLoading?.(false);
    }
  }

  async function loadPositions() {
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
            compliance_state: it.compliance_state || "na",
            zoning_gas: it.zoning_gas ?? null,
            zoning_dust: it.zoning_dust ?? null,
          }))
        : [];
      const list = await enrichStatuses(baseList);
      const zmap = {};
      for (const p of list) {
        zmap[p.id] = {
          zoning_gas: p.zoning_gas ?? null,
          zoning_dust: p.zoning_dust ?? null,
          sub_equipment: p.sub_equipment || null,
        };
      }
      setZonesByEquip(zmap);
      drawMarkers(list);
      log("positions loaded", { count: list.length });
    } catch (e) {
      console.error("[ATEX] loadPositions error", e);
      drawMarkers([]);
    } finally { end(); }
  }
  async function loadSubareas() {
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
      console.error("[ATEX] loadSubareas error", e);
      setSubareasById({});
      drawSubareas([]);
    } finally { end(); }
  }
  async function updateEquipmentMacroAndSub(equipmentId, subareaId, subareaNameDirect = null) {
    try {
      const subName =
        subareaNameDirect ||
        (subareaId ? (subareasById[subareaId]?.name || "") : "");

      const patch = {
        equipment: planDisplayName || "",
        sub_equipment: subName || "",
      };

      if (savedBuilding) patch.building = savedBuilding;
      if (savedZone) patch.zone = savedZone;

      const oldSub = zonesByEquip[equipmentId]?.sub_equipment || "";
      if (subName && subName === oldSub) {
        delete patch.sub_equipment;
      }

      // 🔒 Sécurité : ne jamais écraser avec vide si on avait une valeur
      if (!subName && oldSub) patch.sub_equipment = oldSub;

      log("updateEquipmentMacroAndSub", { equipmentId, ...patch });
      await api.atex.updateEquipment(equipmentId, patch);
    } catch (e) {
      log("updateEquipmentMacroAndSub error", { error: String(e) }, "warn");
    }
  }
  /* ---------------------- Création équipement (utilitaires) ---------------------- */
  function centroidFracOfSubarea(sa) {
    if (!sa) return null;
    if (sa.kind === "rect") {
      const xf = ((sa.x1 ?? 0) + (sa.x2 ?? 0)) / 2;
      const yf = ((sa.y1 ?? 0) + (sa.y2 ?? 0)) / 2;
      return { xf, yf };
    }
    if (sa.kind === "circle") {
      return { xf: sa.cx ?? 0.5, yf: sa.cy ?? 0.5 };
    }
    if (sa.kind === "poly" && Array.isArray(sa.points) && sa.points.length) {
      const n = sa.points.length;
      const sum = sa.points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
      return { xf: sum[0] / n, yf: sum[1] / n };
    }
    return null;
  }
  async function createEquipmentAtFrac(xf, yf, droppedFiles /* optional */) {
    if (!plan || !baseLayerRef.current) return;
    // Prevent double-creation
    if (creatingEquipmentRef.current) {
      log("createEquipmentAtFrac blocked - already creating", {}, "warn");
      return;
    }
    // ✅ Validation des coordonnées et du plan
    const logicalName = plan.logical_name || plan.id;
    if (!logicalName) {
      log("createEquipmentAtFrac error - plan sans logical_name ni id", { plan: safeJson(plan) }, "error");
      alert("Erreur: plan invalide (pas de logical_name)");
      return;
    }
    if (typeof xf !== "number" || typeof yf !== "number" || isNaN(xf) || isNaN(yf)) {
      log("createEquipmentAtFrac error - coordonnées invalides", { xf, yf }, "error");
      alert("Erreur: coordonnées invalides");
      return;
    }
    creatingEquipmentRef.current = true;
    const end = timeStart("createEquipmentAtFrac");
    try {
      // Create equipment with auto-generated name
      const timestamp = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const created = await api.atex.createEquipment({ name: `Nouvel ATEX ${timestamp}`, status: "a_faire" });
      const id = created?.id || created?.equipment?.id;
      if (!id) throw new Error("Création ATEX: ID manquant");
      log("setPosition params", { id, logicalName, plan_id: plan.id, pageIndex, xf, yf });
      const resp = await api.atexMaps.setPosition(id, {
        logical_name: logicalName,
        plan_id: plan.id,
        page_index: pageIndex,
        x_frac: Math.round(xf * 1e6) / 1e6,
        y_frac: Math.round(yf * 1e6) / 1e6,
      });
      log("setPosition (new equip) response", { raw: safeJson(resp) });
      await updateEquipmentMacroAndSub(id, resp?.zones?.subarea_id || null);
      try { onZonesApplied?.(id, { zoning_gas: resp?.zones?.zoning_gas ?? null, zoning_dust: resp?.zones?.zoning_dust ?? null }); } catch {}
      if (droppedFiles && droppedFiles.length) {
        try { await api.atex.uploadAttachments(id, Array.from(droppedFiles)); } catch (e) { log("uploadAttachments error", { error: String(e) }, "warn"); }
      }
      await reloadAll();
      onOpenEquipment?.({ id, name: created?.equipment?.name || created?.name || "Équipement" });
    } catch (e) {
      console.error(e);
      alert("Erreur création équipement");
    } finally {
      creatingEquipmentRef.current = false;
      end();
    }
  }
  async function createEquipmentAtCenter(droppedFiles) {
    if (!plan || !baseLayerRef.current) return;
    let xf, yf;
    const last = lastSubareaId ? subareasById[lastSubareaId] : null;
    if (last) {
      const c = centroidFracOfSubarea(last);
      if (c) { xf = c.xf; yf = c.yf; }
    }
    if (xf == null || yf == null) {
      const center = baseLayerRef.current.getBounds().getCenter();
      const frac = fromLatLngToFrac(center, baseLayerRef.current);
      xf = frac.xf; yf = frac.yf;
    }
    await createEquipmentAtFrac(xf, yf, droppedFiles);
  }
  function drawMarkers(list) {
    const end = timeStart("drawMarkers");
    try {
      const m = mapRef.current;
      const layer = markersLayerRef.current;
      const base = baseLayerRef.current;
      if (!m || !layer || !base) return;
      layer.clearLayers();
      // 🆕 Mettre à jour positionsRef pour le re-dessin lors de changement de sélection
      positionsRef.current = list || [];
      (list || []).forEach((p) => {
        const latlng = toLatLngFrac(p.x, p.y, base);
        // Passer isSelected pour highlight violet, compliance_state pour rouge si non conforme
        const isSelected = p.id === selectedEquipmentIdRef.current;
        const icon = makeEquipIcon(p.status, unsavedIds.has(p.id), isSelected, p.compliance_state);
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
        mk.on("dragstart", () => { draggingRef.current = true; log("marker dragstart", { id: p.id, at: mk.getLatLng() }); });
        mk.on("drag", () => DEBUG() && log("marker drag", { id: p.id, at: mk.getLatLng() }));
        mk.on("dragend", async () => {
          const ll = mk.getLatLng();
          const { xf, yf } = fromLatLngToFrac(ll, base);
          log("marker dragend", { id: p.id, xFrac: xf, yFrac: yf });

          try {
            // 1️⃣ DÉTECTION DE ZONE CÔTÉ FRONTEND (instantané)
            const containingZone = findContainingSubarea(xf, yf, subareasById);
            log("Zone détectée", {
              zone: containingZone?.name,
              zoning_gas: containingZone?.zoning_gas,
              zoning_dust: containingZone?.zoning_dust,
              sub_equipment: containingZone?.name
            });

            // 2️⃣ SAUVEGARDER LA POSITION - AWAIT comme Switchboard!
            const logicalNameForSave = plan?.logical_name || plan?.id;
            if (!logicalNameForSave) {
              log("setPosition skipped - no logical_name or id", { plan: safeJson(plan) }, "warn");
              return;
            }
            await api.atexMaps.setPosition(p.id, {
              logical_name: logicalNameForSave,
              plan_id: plan?.id,
              page_index: pageIndex,
              x_frac: Math.round(xf * 1e6) / 1e6,
              y_frac: Math.round(yf * 1e6) / 1e6,
            });
            log("setPosition OK");

            // 3️⃣ METTRE À JOUR L'ÉQUIPEMENT AVEC LES INFOS DE ZONE
            if (containingZone) {
              await api.atex.updateEquipment(p.id, {
                sub_equipment: containingZone.name || null,
                zoning_gas: containingZone.zoning_gas ?? null,
                zoning_dust: containingZone.zoning_dust ?? null,
                equipment: plan?.display_name || plan?.logical_name || null,
              });
              log("Equipment zone info updated", { sub: containingZone.name, gas: containingZone.zoning_gas, dust: containingZone.zoning_dust });

              // Notifier le parent des zones appliquées
              onZonesApplied?.(p.id, {
                zoning_gas: containingZone.zoning_gas ?? null,
                zoning_dust: containingZone.zoning_dust ?? null,
              });
            }

            // 4️⃣ RECHARGER LES POSITIONS DEPUIS LE BACKEND (comme Switchboard!)
            await loadPositions();
            log("Positions rechargées après drag");

            // 5️⃣ Notifier le parent pour rafraîchir la liste des équipements
            onMetaChanged?.();

          } catch (e) {
            console.error("[ATEX] Erreur lors du déplacement:", e);
            // En cas d'erreur, recharger quand même pour avoir l'état correct
            await loadPositions().catch(() => {});
          } finally {
            draggingRef.current = false;
          }
        });
        mk.on("click", () => {
          onOpenEquipment?.({
            id: p.id,
            name: p.name,
            zones: { 
              zoning_gas: zonesByEquip[p.id]?.zoning_gas ?? null, 
              zoning_dust: zonesByEquip[p.id]?.zoning_dust ?? null 
            },
            // AJOUT : passe la fonction reload du parent
            reload: () => {
              // Si on est dans Atex.jsx, on a accès à reload()
              if (typeof window._atexReload === "function") {
                window._atexReload();
              }
            },
          });
        });
        mk.addTo(layer);
      });
      layer.bringToFront?.();
    } finally { end(); }
  }
  function colorForSubarea(sa) {
    // For infrastructure zones (multi-zone plans), use custom color if available
    if (sa?.color && sa.color !== '#6B7280') {
      return { color: sa.color, weight: 2, opacity: 0.9, fillColor: sa.color, fillOpacity: 0.15, pane: "zonesPane" };
    }
    // For ATEX zones, use gas/dust zoning colors
    const stroke = GAS_STROKE[sa?.zoning_gas ?? null];
    const fill = DUST_FILL[sa?.zoning_dust ?? null];
    return { color: stroke, weight: 1, opacity: 0.9, fillColor: fill, fillOpacity: 0.12, pane: "zonesPane" };
  }
  function clearEditHandles() {
    const lay = editHandlesLayerRef.current;
    if (!lay) return;
    try { lay.clearLayers(); } catch {}
  }
/* =========================================================================
   --- Edition de formes (zones ATEX) : handles + déplacement fluide ---
   ====================================================================== */

// ✅ Helper central pour un drag fluide et sans blocage
function setupHandleDrag(map, onMoveCallback) {
  const move = (ev) => onMoveCallback(ev);
  const up = () => {
    map.off("mousemove", move);
    map.off("mouseup", up);
    map.dragging.enable();
    document.body.style.userSelect = ""; // rétablit la sélection texte
  };
  map.on("mousemove", move);
  map.on("mouseup", up);
  document.body.style.userSelect = "none"; // évite sélection de texte pendant le drag
}

/* --------------------------------------------------------------------------
   RECTANGLE
   -------------------------------------------------------------------------- */
  function mountRectHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;

    const b = layer.getBounds();
    const corners = [b.getSouthWest(), b.getSouthEast(), b.getNorthEast(), b.getNorthWest()];

    const updateByCorners = (pts) => {
      layer.setBounds(L.latLngBounds(pts[0], pts[2]));
    };

    corners.forEach((ll, idx) => {
      const h = L.circleMarker(ll, {
        radius: 5,
        color: "#111827",
        weight: 1,
        fillColor: "#ffffff",
        fillOpacity: 1,
        pane: "editPane",
        bubblingMouseEvents: false,
      }).addTo(lay);

      h.on("mousedown", (e) => {
        m.dragging.disable();
        setupHandleDrag(m, (ev) => {
          corners[idx] = ev.latlng;              // 🔧 mise à jour permanente
          updateByCorners(corners);
          h.setLatLng(ev.latlng);
        });
      });
    });
  }

  /* --------------------------------------------------------------------------
    CERCLE
    -------------------------------------------------------------------------- */
  function mountCircleHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;

    const center = layer.getLatLng();
    const r = layer.getRadius();
    const east = L.latLng(center.lat, center.lng + r);

    const centerH = L.circleMarker(center, {
      radius: 5, color: "#111827", weight: 1,
      fillColor: "#ffffff", fillOpacity: 1, pane: "editPane"
    }).addTo(lay);

    const radiusH = L.circleMarker(east, {
      radius: 5, color: "#111827", weight: 1,
      fillColor: "#ffffff", fillOpacity: 1, pane: "editPane"
    }).addTo(lay);

    // Déplacement du centre
    centerH.on("mousedown", (e) => {
      m.dragging.disable();
      setupHandleDrag(m, (ev) => {
        const c = ev.latlng;
        layer.setLatLng(c);
        centerH.setLatLng(c);
        radiusH.setLatLng(L.latLng(c.lat, c.lng + layer.getRadius()));
      });
    });

    // Redimensionnement du rayon
    radiusH.on("mousedown", (e) => {
      m.dragging.disable();
      setupHandleDrag(m, (ev) => {
        const c = layer.getLatLng();
        const newR = Math.max(4, m.distance(c, ev.latlng));
        layer.setRadius(newR);
        radiusH.setLatLng(L.latLng(c.lat, c.lng + newR));
      });
    });
  }

  /* --------------------------------------------------------------------------
    POLYGONE
    -------------------------------------------------------------------------- */
  function mountPolyHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;

    const latlngs = layer.getLatLngs()[0] || [];

    latlngs.forEach((ll, idx) => {
      const h = L.circleMarker(ll, {
        radius: 5,
        color: "#111827",
        weight: 1,
        fillColor: "#ffffff",
        fillOpacity: 1,
        pane: "editPane",
        bubblingMouseEvents: false
      }).addTo(lay);

      h.on("mousedown", (e) => {
        m.dragging.disable();
        setupHandleDrag(m, (ev) => {
          latlngs[idx] = ev.latlng;                // 🔧 met à jour la réf interne
          layer.setLatLngs([latlngs]);            // redraw fluide
          h.setLatLng(ev.latlng);
        });
      });
    });
  }

  /* --------------------------------------------------------------------------
    DÉMARRAGE DE L'ÉDITION DE FORME
    -------------------------------------------------------------------------- */
  function startGeomEdit(layer, sa) {
    clearEditHandles();
    setGeomEdit({ active: true, kind: sa.kind, shapeId: sa.id, layer });

    if (sa.kind === "rect") mountRectHandles(layer);
    if (sa.kind === "circle") mountCircleHandles(layer);
    if (sa.kind === "poly") mountPolyHandles(layer);

    // Fermer le modal pour plus de clarté pendant l’édition
    setEditorPos(null);

    // Surligne la forme active
    layer.setStyle({ weight: 2.5, color: "#2563eb", dashArray: "4,4" });

    // 🔧 Permet d'annuler avec ESC (et se retire proprement)
    const escHandler = (e) => {
      if (e.key === "Escape") {
        clearEditHandles();
        setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });
        document.body.classList.remove("editing-geom");
        resetAfterGeomEdit(mapRef.current);
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

/* --------------------------------------------------------------------------
    SAUVEGARDE DE LA FORME (CORRIGÉE ANTI-FREEZE)
    -------------------------------------------------------------------------- */
  async function saveGeomEdit() {
    // Vérifications de base
    if (!geomEdit.active || !geomEdit.layer || !geomEdit.shapeId || !baseLayerRef.current) return;
    
    const end = timeStart("saveGeomEdit");
    const ly = geomEdit.layer;
    const base = baseLayerRef.current;
    const dims = getPlanDims(base);
    const m = mapRef.current;

    try {
      // --- 1️⃣ NETTOYAGE PRÉVENTIF IMMÉDIAT ---
      // On libère l'interface tout de suite pour éviter la sensation de blocage
      clearEditHandles();
      document.body.classList.remove("editing-geom");
      document.body.style.userSelect = "";
      
      // Nettoyer TOUS les event handlers potentiellement actifs sur la carte
      if (m) {
        m.dragging.enable();
        m.off("mousemove");
        m.off("mouseup");
        m.off("mousedown");
      }

      // --- 2️⃣ Préparation des données (Extraction) ---
      let payload = {};

      if (geomEdit.kind === "rect") {
        const b = ly.getBounds();
        const { W, H, bounds } = dims;
        payload = {
          kind: "rect",
          x1: (b.getWest() - bounds.getWest()) / W,
          y1: (b.getSouth() - bounds.getSouth()) / H,
          x2: (b.getEast() - bounds.getWest()) / W,
          y2: (b.getNorth() - bounds.getSouth()) / H,
        };
      } else if (geomEdit.kind === "circle") {
        const c = ly.getLatLng();
        const r = ly.getRadius();
        const { W, H, bounds } = dims;
        payload = {
          kind: "circle",
          cx: (c.lng - bounds.getWest()) / W,
          cy: (c.lat - bounds.getSouth()) / H,
          r: r / Math.min(W, H),
        };
      } else if (geomEdit.kind === "poly") {
        const latlngs = ly.getLatLngs()[0] || [];
        const { W, H, bounds } = dims;
        const points = latlngs.map((ll) => [
          (ll.lng - bounds.getWest()) / W,
          (ll.lat - bounds.getSouth()) / H,
        ]);
        payload = { kind: "poly", points };
      }

      // --- 3️⃣ Envoi au backend ---
      await api.atexMaps.updateSubarea(geomEdit.shapeId, payload);

      // 🆕 RESTAURÉ: reindexZones après modification géométrie
      api.atexMaps.reindexZones(plan?.logical_name, pageIndex)
        .then(() => {
          log("reindexZones après updateSubarea geom - OK");
          onMetaChanged?.();
        })
        .catch(e => console.warn("[ATEX] reindexZones après geom:", e?.message));

      // --- 4️⃣ Feedback visuel (Ton Toast Bleu) ---
      const toast = document.createElement("div");
      toast.textContent = "Forme enregistrée";
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        background: "#2563eb", // Bleu
        color: "white",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "13px",
        boxShadow: "0 2px 6px rgba(0,0,0,.2)",
        zIndex: 9999,
        transition: "opacity 0.5s",
      });
      document.body.appendChild(toast);
      setTimeout(() => (toast.style.opacity = "0"), 2000);
      setTimeout(() => toast.remove(), 2600);

      // --- 5️⃣ Recharger les données ---
      await reloadAll();

      // Force un petit rafraîchissement Leaflet si besoin
      if (m) {
        try {
          m.invalidateSize(false);
          await new Promise(requestAnimationFrame);
        } catch {}
      }

    } catch (e) {
      console.error("[ATEX] saveGeomEdit error", e);
      alert("Erreur lors de l'enregistrement de la forme");
    } finally {
      // --- 6️⃣ SÉCURITÉ FINALE (ANTI-FREEZE) ---
      // C'est ici qu'on s'assure que la carte est débloquée quoi qu'il arrive
      
      setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });

      if (m) {
        // Réactive tout ce qui est interactif
        m.dragging.enable();
        m.touchZoom.enable();
        m.doubleClickZoom.enable();
        m.scrollWheelZoom.enable();
        m.boxZoom.enable();
        m.keyboard.enable();
        if (m.tap) m.tap.enable();

        // Tue les écouteurs fantômes une dernière fois
        m.off("mousemove");
        m.off("mousedown");
        m.off("mouseup");
      }

      // Reset CSS global
      document.body.classList.remove("editing-geom");
      document.body.style.userSelect = "auto"; // Rétablit la sélection de texte

      end();
    }
  }

    /* --------------------------------------------------------------------------
    RÉINITIALISATION GLOBALE APRÈS ÉDITION
    -------------------------------------------------------------------------- */
  function resetAfterGeomEdit(map) {
    try {
      if (map) {
        map.dragging.enable();
        map.off("mousemove");
        map.off("mouseup");
        map.off("mousedown");
        map.eachLayer((l) => {
          if (l.options?.interactive) l._path && (l._path.style.pointerEvents = "auto");
        });
      }
    } catch (err) {
      console.warn("[ATEX] resetAfterGeomEdit error", err);
    }

    document.body.classList.remove("editing-geom");
    document.body.style.userSelect = "";

    const editPane = document.querySelector(".leaflet-pane.editPane");
    if (editPane) editPane.style.pointerEvents = "auto";

    const inter = document.querySelectorAll(".leaflet-interactive");
    inter.forEach((el) => (el.style.pointerEvents = "auto"));
  }

  // Helper pour estimer la taille de la zone (pour l'ordre d'affichage)
  function getAreaApprox(sa, dims) {
    const W = dims?.W || 1000;
    const H = dims?.H || 1000;
    
    if (sa.kind === "rect") {
      return Math.abs((sa.x2 ?? 0) - (sa.x1 ?? 0)) * W * Math.abs((sa.y2 ?? 0) - (sa.y1 ?? 0)) * H;
    }
    if (sa.kind === "circle") {
      const r = (sa.r ?? 0) * Math.min(W, H);
      return Math.PI * r * r;
    }
    if (sa.kind === "poly" && Array.isArray(sa.points)) {
       // Estimation simple via Bounding Box
       let minX=1, maxX=0, minY=1, maxY=0;
       sa.points.forEach(([x,y]) => {
         if(x<minX) minX=x; if(x>maxX) maxX=x;
         if(y<minY) minY=y; if(y>maxY) maxY=y;
       });
       return (maxX-minX)*W * (maxY-minY)*H;
    }
    return 999999999; // Fallback très grand
  }

  function drawSubareas(items) {
    const end = timeStart("drawSubareas");
    try {
      const m = mapRef.current;
      const base = baseLayerRef.current;
      if (!m || !base) return;
      if (!subareasLayerRef.current)
        subareasLayerRef.current = L.layerGroup({ pane: "zonesPane" }).addTo(m);

      const g = subareasLayerRef.current;
      g.clearLayers();
      clearEditHandles(); 
      setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });

      const dims = getPlanDims(base);
      const { W, H, bounds } = dims;

      // === CORRECTION ICI ===
      // On trie pour dessiner les GRANDES zones d'abord (au fond)
      // et les PETITES zones ensuite (au dessus, pour pouvoir cliquer dessus)
      const sortedItems = [...(items || [])].sort((a, b) => {
        return getAreaApprox(b, dims) - getAreaApprox(a, dims);
      });
      // ======================

      sortedItems.forEach((sa) => {
        let layer = null;
        const style = colorForSubarea(sa);

        // Support both old format (x1,y1,x2,y2) and new format (geometry JSONB)
        const geom = typeof sa.geometry === 'string' && sa.geometry ? JSON.parse(sa.geometry) : (sa.geometry || {});
        const hasGeometry = geom && Object.keys(geom).length > 0;

        if (sa.kind === "rect") {
          const x1 = bounds.getWest() + (hasGeometry ? (geom.x1 ?? 0) : (sa.x1 ?? 0)) * W;
          const y1 = bounds.getSouth() + (hasGeometry ? (geom.y1 ?? 0) : (sa.y1 ?? 0)) * H;
          const x2 = bounds.getWest() + (hasGeometry ? (geom.x2 ?? 0) : (sa.x2 ?? 0)) * W;
          const y2 = bounds.getSouth() + (hasGeometry ? (geom.y2 ?? 0) : (sa.y2 ?? 0)) * H;
          const b = L.latLngBounds(L.latLng(y1, x1), L.latLng(y2, x2));
          layer = L.rectangle(b, style);
        } else if (sa.kind === "circle") {
          const cx = bounds.getWest() + (hasGeometry ? (geom.cx ?? 0.5) : (sa.cx ?? 0.5)) * W;
          const cy = bounds.getSouth() + (hasGeometry ? (geom.cy ?? 0.5) : (sa.cy ?? 0.5)) * H;
          const r = Math.max(4, (hasGeometry ? (geom.r ?? 0.05) : (sa.r ?? 0.05)) * Math.min(W, H));
          layer = L.circle(L.latLng(cy, cx), { radius: r, ...style });
        } else if (sa.kind === "poly") {
          const points = hasGeometry ? (geom.points || []) : (sa.points || []);
          const pts = points.map((pt) => {
            const [xf, yf] = Array.isArray(pt) ? pt : [pt.x, pt.y];
            return [bounds.getSouth() + yf * H, bounds.getWest() + xf * W];
          });
          layer = L.polygon(pts, style);
        }

        if (!layer) return;
        layer.__meta = sa;
        layer.addTo(g);

        layer.on("click", (e) => {
          // Empêche le clic de "traverser" vers la grande zone dessous
          L.DomEvent.stopPropagation(e); 
          
          setEditorInit({
            id: sa.id,
            name: sa.name || "",
            zoning_gas: sa.zoning_gas ?? null,
            zoning_dust: sa.zoning_dust ?? null,
          });
          setEditorPos({
            screen: e.originalEvent
              ? { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
              : null,
            shapeId: sa.id,
            layer,
            kind: sa.kind,
          });
        });

        // Label
        if (sa?.name) {
          const center = layer.getBounds?.().getCenter?.() || layer.getLatLng?.() || null;
          if (center) {
            L.marker(center, {
              interactive: false,
              pane: "zonesPane",
              icon: L.divIcon({
                className: "atex-subarea-label",
                html: `<div class="px-2 py-1 rounded bg-white/90 border shadow text-[11px] truncate max-w-[100px]">${sa.name}</div>`,
              }),
            }).addTo(g);
          }
        }
      });

      // Assurer l'ordre visuel des couches (si l'API existe)
      if (g && typeof g.bringToBack === "function") {
        g.bringToBack();
      }
      if (markersLayerRef.current && typeof markersLayerRef.current.bringToFront === "function") {
        markersLayerRef.current.bringToFront();
      }
      
    } catch (e) {
      console.error("[ATEX] drawSubareas error", e);
    } finally {
      end();
    }
  }

  /* -------- Dessin zones -------- */
  function setDrawMode(mode) {
    if (mode === "rect") setDrawing(DRAW_RECT);
    else if (mode === "circle") setDrawing(DRAW_CIRCLE);
    else if (mode === "poly") { setPolyTemp([]); setDrawing(DRAW_POLY); }
    else setDrawing(DRAW_NONE);
  }
  // RECT / CIRCLE
  useEffect(() => {
    const m = mapRef.current;
    const base = baseLayerRef.current;
    if (!m || !base || drawing === DRAW_NONE || drawing === DRAW_POLY) return;
    let startPt = null;
    let tempLayer = null;
    const mode = drawing;
    const onDown = (e) => {
      startPt = e.latlng;
      if (mode === DRAW_CIRCLE) {
        tempLayer = L.circle(e.latlng, { radius: 1, ...colorForSubarea({}), fillOpacity: 0.12, pane: "zonesPane" }).addTo(m);
      }
      if (mode === DRAW_RECT) {
        tempLayer = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { ...colorForSubarea({}), fillOpacity: 0.12, pane: "zonesPane" }).addTo(m);
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
        setDrawing(DRAW_NONE); return;
      }
      openSubareaEditorAtCenter(
        async (meta) => {
          const end = timeStart("createSubarea (from tempLayer)");
          try {
            const dims = getPlanDims(base);
            if (!dims) return;
            const { W, H, bounds } = dims;
            let created = null;
            if (mode === DRAW_CIRCLE) {
              const ll = tempLayer.getLatLng();
              const r = tempLayer.getRadius();
              const payload = {
                kind: "circle",
                cx: (ll.lng - bounds.getWest()) / W,
                cy: (ll.lat - bounds.getSouth()) / H,
                r: r / Math.min(W, H),
                name: meta.name, zoning_gas: meta.zoning_gas, zoning_dust: meta.zoning_dust,
                plan_id: plan?.id, logical_name: plan?.logical_name, page_index: pageIndex,
              };
              created = await api.atexMaps.createSubarea(payload);
            } else if (mode === DRAW_RECT) {
              const b = tempLayer.getBounds();
              const payload = {
                kind: "rect",
                x1: (b.getWest() - bounds.getWest()) / W,
                y1: (b.getSouth() - bounds.getSouth()) / H,
                x2: (b.getEast() - bounds.getWest()) / W,
                y2: (b.getNorth() - bounds.getSouth()) / H,
                name: meta.name, zoning_gas: meta.zoning_gas, zoning_dust: meta.zoning_dust,
                plan_id: plan?.id, logical_name: plan?.logical_name, page_index: pageIndex,
              };
              created = await api.atexMaps.createSubarea(payload);
            }
            const zid = created?.id || created?.subarea?.id;
            if (zid) setLastSubareaId(zid);

            // 🆕 RESTAURÉ: Appeler reindexZones pour mettre à jour les équipements dans cette zone
            // Fire and forget pour ne pas bloquer l'UI
            api.atexMaps.reindexZones(plan?.logical_name, pageIndex)
              .then(() => {
                log("reindexZones après création zone - OK");
                onMetaChanged?.(); // 🆕 Notifier le parent pour rafraîchir la liste
              })
              .catch(e => console.warn("[ATEX] reindexZones après création:", e?.message));

          } catch (e) {
            console.error("[ATEX] Subarea create failed", e);
            alert("Erreur création zone");
          } finally {
            try { tempLayer && m.removeLayer(tempLayer); } catch {}
            await reloadAll();
            end();
          }
        },
        () => { try { tempLayer && m.removeLayer(tempLayer); } catch {} }
      );
      setDrawMenu(false);
      setDrawing(DRAW_NONE);
      m.off("mousedown", onDown); m.off("mousemove", onMove); m.off("mouseup", onUp);
    };
    m.on("mousedown", onDown);
    m.on("mousemove", onMove);
    m.on("mouseup", onUp);
    return () => {
      try { m.off("mousedown", onDown); m.off("mousemove", onMove); m.off("mouseup", onUp); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, planKey, pageIndex]);
  // POLY
  useEffect(() => {
    const m = mapRef.current;
    const base = baseLayerRef.current;
    if (!m || !base || drawing !== DRAW_POLY) return;
    let tempPoly = null;
    const style = { ...colorForSubarea({}), fillOpacity: 0.12, pane: "zonesPane" };
    const redraw = () => {
      if (tempPoly) { try { m.removeLayer(tempPoly); } catch {} tempPoly = null; }
      if (polyTemp.length >= 1) {
        tempPoly = L.polygon(polyTemp, style).addTo(m);
      }
    };
    const onClick = (e) => {
      setPolyTemp((old) => [...old, e.latlng]);
    };
    const onDblClick = () => {
      if (polyTemp.length < 3) return;
      openSubareaEditorAtCenter(
        async (meta) => {
          const end = timeStart("createSubarea (poly)");
          try {
            const { W, H, bounds } = getPlanDims(base);
            const points = polyTemp.map((ll) => [(ll.lng - bounds.getWest()) / W, (ll.lat - bounds.getSouth()) / H]);
            const created = await api.atexMaps.createSubarea({
              kind: "poly",
              points,
              name: meta.name,
              zoning_gas: meta.zoning_gas,
              zoning_dust: meta.zoning_dust,
              plan_id: plan?.id,
              logical_name: plan?.logical_name,
              page_index: pageIndex,
            });
            const zid = created?.id || created?.subarea?.id;
            if (zid) setLastSubareaId(zid);
            // 🆕 RESTAURÉ: Appeler reindexZones pour mettre à jour les équipements dans cette zone
            api.atexMaps.reindexZones(plan?.logical_name, pageIndex)
              .then(() => {
                log("reindexZones après création poly - OK");
                onMetaChanged?.();
              })
              .catch(e => console.warn("[ATEX] reindexZones après poly:", e?.message));
          } catch (e) {
            console.error("[ATEX] Subarea poly create failed", e);
            alert("Erreur création polygone");
          } finally {
            setPolyTemp([]);
            try { tempPoly && m.removeLayer(tempPoly); } catch {}
            await reloadAll();
            end();
          }
        },
        () => { setPolyTemp([]); try { tempPoly && m.removeLayer(tempPoly); } catch {} }
      );
      setDrawMenu(false);
      setDrawing(DRAW_NONE);
    };
    const onMove = () => redraw();
    m.on("click", onClick);
    m.on("mousemove", onMove);
    m.on("dblclick", onDblClick);
    return () => {
      try { m.off("click", onClick); m.off("mousemove", onMove); m.off("dblclick", onDblClick); } catch {}
      try { tempPoly && m.removeLayer(tempPoly); } catch {}
    };
  }, [drawing, polyTemp, planKey, pageIndex]);
  function openSubareaEditorAtCenter(onSave, onCancelCleanup) {
    const m = mapRef.current;
    if (!m) return;
    const sz = m.getSize();
    setEditorInit({});
    setEditorPos({ screen: { x: sz.x / 2, y: 80 }, shapeId: null, onSave, onCancel: onCancelCleanup });
  }
  async function onSaveSubarea(meta) {
    const end = timeStart("onSaveSubarea");
    try {
      if (editorPos?.onSave) {
        await editorPos.onSave(meta);
        setEditorPos(null); return;
      }
      if (editorPos?.shapeId) {
        const payload = { name: meta.name, zoning_gas: meta.zoning_gas, zoning_dust: meta.zoning_dust };
        await api.atexMaps.updateSubarea(editorPos.shapeId, payload);

        // Propagation automatique si nom changé
        if (meta?.name && meta.name !== editorInit.name) {
          try {
            if (api.atexMaps?.bulkRename) {
              await api.atexMaps.bulkRename({
                field: "sub_equipment",
                from: editorInit.name || "",
                to: meta.name,
              });
              console.info("[ATEX] Nom sous-zone propagé aux équipements");
            } else {
              console.warn("[ATEX] bulkRename non disponible dans api.atexMaps");
            }
          } catch (e) {
            console.warn("Propagation sous-zone échouée:", e);
          }
        }

        // 🆕 RESTAURÉ: reindexZones après modification métadonnées zone
        api.atexMaps.reindexZones(plan?.logical_name, pageIndex)
          .then(() => {
            log("reindexZones après updateSubarea meta - OK");
            onMetaChanged?.();
          })
          .catch(e => console.warn("[ATEX] reindexZones après meta:", e?.message));

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

/* ----------------------------- DnD: création + upload ----------------------------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };

    const onDrop = async (e) => {
      prevent(e);
      if (!baseLayerRef.current || !plan) return; // Sécurité ajoutée ici
      
      const files = e.dataTransfer?.files;
      // position du drop -> latlng
      let xf = null, yf = null;
      try {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const m = mapRef.current;
        const ll = m?.containerPointToLatLng?.([px, py]);
        if (ll) {
          const frac = fromLatLngToFrac(ll, baseLayerRef.current);
          xf = frac.xf; yf = frac.yf;
        }
      } catch {}
      
      // fallback: centroïde dernière zone ou centre plan
      if (xf == null || yf == null) {
        const last = lastSubareaId ? subareasById[lastSubareaId] : null;
        const c = last ? centroidFracOfSubarea(last) : null;
        if (c) { xf = c.xf; yf = c.yf; }
      }
      if (xf == null || yf == null) {
        const center = baseLayerRef.current.getBounds().getCenter();
        const frac = fromLatLngToFrac(center, baseLayerRef.current);
        xf = frac.xf; yf = frac.yf;
      }
      
      await createEquipmentAtFrac(xf, yf, files);
    };

    el.addEventListener("dragenter", prevent);
    el.addEventListener("dragover", prevent);
    el.addEventListener("dragleave", prevent);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", prevent);
      el.removeEventListener("dragover", prevent);
      el.removeEventListener("dragleave", prevent);
      el.removeEventListener("drop", onDrop);
    };
    // === CORRECTION ICI : ajout de [plan, pageIndex] ===
  }, [lastSubareaId, subareasById, plan, pageIndex]);
  /* ----------------------------- RENDER ----------------------------- */
  // 🖥️ Sur grand écran, utiliser toute la hauteur disponible (pas de limite par imgSize)
  const windowH = typeof window !== "undefined" ? window.innerHeight : 900;
  const isLargeScreen = windowH > 800;
  const viewerHeight = isLargeScreen
    ? windowH - 160  // Grand écran : prendre toute la hauteur moins le header
    : Math.min(windowH - 140, imgSize.h || 900);  // Mobile/petit écran : limiter
  const toggleLegend = () => {
    setLegendVisible((v) => {
      const next = !v;
      const el = legendRef.current?.getContainer?.();
      if (el) el.style.display = next ? "block" : "none";
      return next;
    });
  };
  const editorStyle = editorPos?.screen
    ? {
        left: Math.max(
          8,
          Math.min(
            (editorPos.screen.x || 0) - 150,
            (typeof window !== "undefined" ? window.innerWidth : 1200) - 300
          )
        ),
        top: Math.max(
          8,
          Math.min(
            (editorPos.screen.y || 0) - 10,
            (typeof window !== "undefined" ? window.innerHeight : 800) - 260
          )
        ),
      }
    : {};
  const MapInner = (
    <div
      ref={wrapRef}
      className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
      style={{ height: Math.max(520, viewerHeight) }}
    >
      {/* Toolbar */}
      <div className="atex-toolbar">
        {/* Ajouter un équipement */}
        <button
          className="btn-plus"
          onClick={() => createEquipmentAtCenter()}
          title="Ajouter un équipement (centre / dernière zone)"
        >
          +
        </button>
        {/* Dessin zones */}
        <div className="btn-pencil-wrap" ref={drawMenuRef}>
          <button
            className="btn-pencil"
            onClick={() => setDrawMenu((v) => !v)}
            title="Dessiner (zones ATEX)"
          >
            ✏️  
          </button>
          {drawMenu && (
            <div className="draw-menu">
              <button
                onClick={() => {
                  setDrawMode("rect");
                  setDrawMenu(false);
                }}
              >
                Rectangle
              </button>
              <button
                onClick={() => {
                  setDrawMode("poly");
                  setDrawMenu(false);
                }}
              >
                Polygone
              </button>
              <button
                onClick={() => {
                  setDrawMode("circle");
                  setDrawMenu(false);
                }}
              >
                Cercle
              </button>
              <button
                onClick={() => {
                  setDrawMode("none");
                  setDrawMenu(false);
                }}
              >
                Annuler
              </button>
            </div>
          )}
        </div>
        {/* Fin polygone */}
        {drawing === DRAW_POLY && (
          <button
            className="btn-pencil"
            title="Terminer le polygone"
            onClick={() => {
              const m = mapRef.current;
              if (!m || polyTemp.length < 3) return;
              const ev = new MouseEvent("dblclick");
              m.getContainer().dispatchEvent(ev);
            }}
          >
            ✅  
          </button>
        )}
        {/* Ajuster la vue */}
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
          }}
        >
          🗺️
        </button>
        {geomEdit.active && (
          <button
            className="btn-pencil"
            title="Sauvegarder la géométrie"
            onClick={saveGeomEdit}
          >
            💾
          </button>
        )}
        {/* Légende - 🆕 Bouton distinct et plus visible */}
        <button
          className="btn-legend"
          title={legendVisible ? "Cacher la légende" : "Afficher la légende"}
          onClick={toggleLegend}
        >
          {legendVisible ? "✕" : "ℹ️"}
        </button>
      </div>
      {/* Overlay aide polygone */}
      {drawing === DRAW_POLY && (
        <div className="absolute left-3 top-3 z-[5000] px-2 py-1 text-[11px] rounded bg-blue-50 border border-blue-200 text-blue-800 shadow">
          Mode polygone : cliquez pour ajouter des sommets, puis “Terminer polygone”.
        </div>
      )}
    </div>
  );
  const EditorPopover = editorPos?.screen ? (
    <div className="fixed z-[7000]" style={editorStyle}>
      <SubAreaEditor
        key={editorPos?.shapeId || `new-${Date.now()}`}
        initial={editorInit}
        onSave={onSaveSubarea}
        onCancel={() => {
          // callback éventuel spécifique (création via dessin, etc.)
          editorPos?.onCancel?.();
          setEditorPos(null);

          // 🔒 SÉCURITÉ : si jamais on était resté en mode édition de forme, on le coupe
          try {
            resetAfterGeomEdit(mapRef.current);
          } catch {}
          setGeomEdit((g) => ({
            ...g,
            active: false,
            kind: null,
            shapeId: null,
            layer: null,
          }));
          document.body.classList.remove("editing-geom");
          document.body.style.userSelect = "";
        }}
        onStartGeomEdit={
          editorPos?.layer && editorPos?.kind
            ? () =>
                startGeomEdit(editorPos.layer, {
                  id: editorPos.shapeId,
                  kind: editorPos.kind,
                })
            : undefined
        }
        allowDelete={!!editorPos?.shapeId}
        onDelete={onDeleteSubarea}
      />
    </div>
  ) : null;
  const MarkerLegend = (
    <div className="flex items-center gap-3 mt-2 text-xs text-gray-600 flex-wrap">
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-full" style={{ background: "#059669" }} />
        À faire
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="w-3 h-3 rounded-full blink-orange"
          style={{ background: "#f59e0b" }}
        />
        ≤90j
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="w-3 h-3 rounded-full blink-red"
          style={{ background: "#e11d48" }}
        />
        En retard
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-full" style={{ background: "#2563eb" }} />
        Nouvelle (à enregistrer)
      </span>
      <span className="inline-flex items-center gap-1 text-gray-500">
        • Remplissage = Poussière • Bordure = Gaz
      </span>
    </div>
  );
  if (!inModal) {
    return (
      <div className="relative">
        {MapInner}
        {EditorPopover}
        {MarkerLegend}
      </div>
    );
  }
  // ----------------------------- META (Bâtiment / Zone) -----------------------------
  useEffect(() => {
    if (!plan) return;
    const key = plan.id || plan.logical_name;
    if (!key) return;

    api.atexMaps
      .getMeta(key)
      .then((res) => {
        const b = res?.building || "";
        const z = res?.zone || "";
        setBuilding(b);
        setZone(z);
        setSavedBuilding(b);
        setSavedZone(z);
      })
      .catch((err) => console.warn("getMeta error (ignored):", err));
  }, [plan?.id, plan?.logical_name]);

  async function handleMetaChange(nextBuilding, nextZone) {
    if (!plan) return;
    const key = plan.id || plan.logical_name;

    const prevBuilding = building;
    const prevZone = zone;

    try {
      // 1️⃣ Met à jour les métadonnées du plan
      await api.atexMaps.setMeta(key, { building: nextBuilding, zone: nextZone });

      // 2️⃣ Propagation automatique aux équipements
      if (nextBuilding && nextBuilding !== prevBuilding) {
        await api.atex.bulkRename({
          field: "building",
          from: prevBuilding || "",
          to: nextBuilding,
        });
      }
      if (nextZone && nextZone !== prevZone) {
        await api.atex.bulkRename({
          field: "zone",
          from: prevZone || "",
          to: nextZone,
        });
      }

      // 3️⃣ Met à jour l’état React local
      setBuilding(nextBuilding);
      setZone(nextZone);
      await new Promise((r) => setTimeout(r, 100)); // attendre que React applique les changements

      // 4️⃣ Recharge les sous-zones + positions
      await reloadAll();

      // 🧭 Attendre un cycle complet de rendu du plan avant redessiner
      await new Promise((resolve) => setTimeout(resolve, 250));
      await new Promise(requestAnimationFrame);

      // 5️⃣ Forcer la recalibration des coordonnées équipements
      try {
        const eqResp = await api.atex.listEquipments?.({ plan: key });
        const eqItems = Array.isArray(eqResp?.items) ? eqResp.items : [];
        if (eqItems.length > 0) {
          // 🧭 Attendre le rendu complet du plan avant de replacer les marqueurs
          await new Promise(requestAnimationFrame);
          baseLayerRef.current?.bringToFront?.();
          drawMarkers(eqItems.map((it) => {
            const x = Number(it.x_frac ?? it.x ?? 0);
            const y = Number(it.y_frac ?? it.y ?? 0);
            // 🧭 corrige le décalage : Leaflet recalcule les bounds après reload
            const base = baseLayerRef.current;
            if (base) {
              const ll = toLatLngFrac(x, y, base);
              return { ...it, x, y, latlng: ll };
            }
            return { ...it, x, y };
          }));
        }
      } catch (e) {
        console.warn("[ATEX] Erreur rechargement équipements:", e);
      }

      // 6️⃣ Force un tick de rafraîchissement pour la carte (corrige disparition)
      setMapRefreshTick((t) => t + 1);

      // 7️⃣ Feedback visuel
      const toast = document.createElement("div");
      toast.textContent = "Changements enregistrés";
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        background: "#059669",
        color: "white",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "13px",
        boxShadow: "0 2px 6px rgba(0,0,0,.2)",
        zIndex: 9999,
        transition: "opacity 0.5s",
      });
      document.body.appendChild(toast);
      setTimeout(() => (toast.style.opacity = "0"), 2000);
      setTimeout(() => toast.remove(), 2600);

      // 8️⃣ Informe le parent pour mise à jour des filtres éventuels
      if (typeof onMetaChanged === "function") {
        onMetaChanged();
      }
    } catch (err) {
      console.error("[ATEX] Erreur mise à jour meta:", err);
    }
  }

  function handleClosePlan() {
    try {
      console.info("[ATEX] Fermeture du plan en cours…");

      // 1️⃣ Supprimer la carte Leaflet proprement
      if (mapRef.current) {
        try {
          mapRef.current.off();
          mapRef.current.eachLayer((l) => mapRef.current.removeLayer(l));
          mapRef.current.remove();
        } catch (err) {
          console.warn("[ATEX] Erreur nettoyage Leaflet:", err);
        }
        mapRef.current = null;
      }

      // 2️⃣ Nettoyage des observers & events globaux
      try {
        roRef.current?.disconnect?.();
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      } catch {}
      roRef.current = null;

      // 3️⃣ Purge DOM Leaflet (divs fantômes)
      document.querySelectorAll(".leaflet-container, .leaflet-pane, .leaflet-control").forEach((el) => el.remove());
      // 🧹 Supprime les éventuelles cartes ou cards résiduelles
      document.querySelectorAll(".plan-card, .plan-preview, .plan-footer").forEach((el) => el.remove());
      document.body.classList.remove("editing-geom");
      document.body.style.userSelect = "";

      // 4️⃣ Reset des refs React
      baseReadyRef.current = false;
      lastJob.current.key = null;
      baseLayerRef.current = null;
      markersLayerRef.current = null;
      subareasLayerRef.current = null;
      editHandlesLayerRef.current = null;
      legendRef.current = null;

      // 5️⃣ Reset des états
      setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });
      setEditorPos(null);
      setEditorInit({});
      setDrawing(DRAW_NONE);
      setPolyTemp([]);
      setZonesByEquip({});
      setSubareasById({});
      setLegendVisible(true);
      setOpen(false);
      setTimeout(() => (mapRef.current = null), 150);

      // 6️⃣ Forcer la fermeture visuelle du modal immédiatement
      setTimeout(() => {
        const modal = Array.from(document.querySelectorAll(".fixed"))
          .find(el => el.className.includes("z-[6000]"));
        if (modal) modal.remove();
      }, 200);

      console.info("[ATEX] Plan fermé et nettoyé ✅");
    } catch (err) {
      console.error("[ATEX] Erreur fermeture plan:", err);
    }
  }


  // --- Modal plein écran
  return (
    <>
      {/* Indicateur de chargement PDF - Design moderne avec icône ATEX */}
      {pdfLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm mx-4 border">
            <div className="text-center space-y-5">
              {/* Icône ATEX animée */}
              <div className="relative mx-auto w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-emerald-500 animate-spin"></div>
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white animate-pulse">
                    <path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/>
                  </svg>
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-800 text-lg">Chargement du plan ATEX</div>
                <div className="text-sm text-gray-500 mt-1">
                  {isMobileDevice()
                    ? "Optimisation mobile en cours..."
                    : "Rendu haute qualité..."}
                </div>
              </div>
              {/* Barre de progression simulée */}
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-full rounded-full animate-progress"></div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {!open && (
        <Btn className="mt-2" onClick={() => setOpen(true)}>
          Ouvrir le plan
        </Btn>
      )}
      {open && (
        <div className="fixed inset-0 z-[6000] flex flex-col">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={handleClosePlan}
          />
          {/* Dialog - 🖥️ Plus large sur grand écran */}
          <div className="relative z-[6001] mx-auto my-0 h-[100dvh] w-full md:w-[min(1400px,96vw)] lg:w-[min(1800px,96vw)] md:h-[94dvh] md:my-[3vh]">
            <div className="bg-white rounded-none md:rounded-2xl shadow-lg h-full flex flex-col overflow-hidden">
              {/* 🆕 Header redesigné - compact sur mobile + safe-area iOS */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white pt-[env(safe-area-inset-top)]">
                {/* Ligne 1: Titre + Fermer */}
                <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl sm:text-2xl">🗺️</span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm sm:text-base truncate">
                        {planDisplayName || title || "Plan ATEX"}
                        {plan?.is_multi_zone && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-500/30 text-white text-xs rounded-full">Multi-zones</span>
                        )}
                      </div>
                      {/* Mobile: affiche bâtiment/zone en sous-titre (sauf multi-zone) */}
                      {!plan?.is_multi_zone && (
                        <div className="text-amber-100 text-xs sm:hidden truncate">
                          {building || "Bâtiment"} • {zone || "Zone"}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleClosePlan}
                    className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg transition-all shrink-0"
                    title="Fermer"
                  >
                    ✕
                  </button>
                </div>

                {/* Ligne 2: Champs bâtiment/zone (masqués sur mobile et pour plans multi-zone) */}
                {!plan?.is_multi_zone && (
                <div className="hidden sm:flex items-center gap-3 px-4 pb-3 flex-wrap">
                  {/* Champ Bâtiment */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-amber-100">Bâtiment</span>
                    <input
                      className="border-0 rounded-lg px-2 py-1 text-sm w-[140px] bg-white/90 text-gray-800 placeholder-gray-400"
                      value={building}
                      onChange={(e) => setBuilding(e.target.value)}
                      placeholder="Ex: Bât. A"
                    />
                    {building.trim() !== savedBuilding.trim() && (
                      <button
                        className="px-2 py-1 bg-white/30 hover:bg-white/40 text-white rounded text-sm font-medium"
                        title="Enregistrer"
                        onClick={async () => {
                          await handleMetaChange(building, zone);
                          setSavedBuilding(building);
                        }}
                      >
                        ✔
                      </button>
                    )}
                  </div>

                  {/* Champ Zone */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-amber-100">Zone</span>
                    <input
                      className="border-0 rounded-lg px-2 py-1 text-sm w-[140px] bg-white/90 text-gray-800 placeholder-gray-400"
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                      placeholder="Ex: Niv. 2"
                    />
                    {zone.trim() !== savedZone.trim() && (
                      <button
                        className="px-2 py-1 bg-white/30 hover:bg-white/40 text-white rounded text-sm font-medium"
                        title="Enregistrer"
                        onClick={async () => {
                          await handleMetaChange(building, zone);
                          setSavedZone(zone);
                        }}
                      >
                        ✔
                      </button>
                    )}
                  </div>
                </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden">
                {MapInner}
                <div className="p-2 sm:p-3">{MarkerLegend}</div>
              </div>
            </div>
          </div>
          {EditorPopover}
        </div>
      )}
    </>
  );
}
/* ----------------------------- Sous-composants locaux ----------------------------- */
function AtexZipImport({ disabled, onDone }) {
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
            await api.atexMaps.uploadZip(f);
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
          <div className="text-[11px] mt-1">PDF</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">
          {name}
        </div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>
              {name || "—"}
            </div>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" aria-label="Renommer le plan" onClick={() => setEdit(true)}>
                [Pencil Icon]
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
