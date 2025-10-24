// src/pages/Atex.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import "../styles/atex-map.css";
import { api, API_BASE } from "../lib/api.js";

import AtexMap from "./Atex-map.jsx";

/* ----------------------------- Utils ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  console.log("[Atex.jsx] Entering Btn");
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    ghost: "bg-white text-black border hover:bg-gray-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    warn: "bg-amber-500 text-white hover:bg-amber-600",
  };
  console.log("[Atex.jsx] Exiting Btn");
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
  console.log("[Atex.jsx] Entering Input");
  console.log("[Atex.jsx] Exiting Input");
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
  console.log("[Atex.jsx] Entering Textarea");
  console.log("[Atex.jsx] Exiting Textarea");
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
  console.log("[Atex.jsx] Entering Select");
  console.log("[Atex.jsx] Exiting Select");
  return (
    <select
      className=`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
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
  console.log("[Atex.jsx] Entering Badge");
  const map = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-emerald-100 text-emerald-700",
    orange: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    blue: "bg-blue-100 text-blue-700",
  };
  console.log("[Atex.jsx] Exiting Badge");
  return (
    <span className=`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color] || map.gray} ${className}`>
      {children}
    </span>
  );
}
function Labeled({ label, children }) {
  console.log("[Atex.jsx] Entering Labeled");
  console.log("[Atex.jsx] Exiting Labeled");
  return (
    <label className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      {children}
    </label>
  );
}
function Drawer({ title, children, onClose }) {
  console.log("[Atex.jsx] Entering Drawer");
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  console.log("[Atex.jsx] Exiting Drawer");
  return (
    <div className="fixed inset-0 z-[6000]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[680px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}
function Toast({ text, onClose }) {
  console.log("[Atex.jsx] Entering Toast");
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  if (!text) return null;
  console.log("[Atex.jsx] Exiting Toast");
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000]">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>
    </div>
  );
}

/* ---- Dates pour <input type="date"> ---- */
function asDateInput(v) {
  console.log("[Atex.jsx] Entering asDateInput");
  if (!v) return "";
  const d = dayjs(v);
  console.log("[Atex.jsx] Exiting asDateInput");
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

/* ----------------------------- Status ----------------------------- */
const STATUS = {
  A_FAIRE: "a_faire",
  EN_COURS: "en_cours_30",
  EN_RETARD: "en_retard",
  FAIT: "fait",
};
function statusColor(s) {
  console.log("[Atex.jsx] Entering statusColor");
  if (s === STATUS.A_FAIRE) return "green";
  if (s === STATUS.EN_COURS) return "orange";
  if (s === STATUS.EN_RETARD) return "red";
  if (s === STATUS.FAIT) return "blue";
  console.log("[Atex.jsx] Exiting statusColor");
  return "gray";
}
function statusLabel(s) {
  console.log("[Atex.jsx] Entering statusLabel");
  if (s === STATUS.A_FAIRE) return "À faire";
  if (s === STATUS.EN_COURS) return "En cours (<30j)";
  if (s === STATUS.EN_RETARD) return "En retard";
  if (s === STATUS.FAIT) return "Fait";
  console.log("[Atex.jsx] Exiting statusLabel");
  return s || "—";
}

/* ----------------------------- Mini calendrier ----------------------------- */
function MonthCalendar({ events = [], onDayClick }) {
  console.log("[Atex.jsx] Entering MonthCalendar");
  const [cursor, setCursor] = useState(() => dayjs().startOf("month"));
  console.log("[Atex.jsx] State change in MonthCalendar: " + JSON.stringify(arguments));
  const start = cursor.startOf("week");
  const end = cursor.endOf("month").endOf("week");
  const days = [];
  let d = start;
  while (d.isBefore(end)) {
    days.push(d);
    d = d.add(1, "day");
  }
  const map = new Map();
  for (const e of events) {
    const k = dayjs(e.date).format("YYYY-MM-DD");
    const arr = map.get(k) || [];
    arr.push(e);
    map.set(k, arr);
  }
  console.log("[Atex.jsx] Exiting MonthCalendar");
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{cursor.format("MMMM YYYY")}</div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setCursor(cursor.subtract(1, "month"))}>◀</Btn>
          <Btn variant="ghost" onClick={() => setCursor(dayjs().startOf("month"))}>Aujourd’hui</Btn>
          <Btn variant="ghost" onClick={() => setCursor(cursor.add(1, "month"))}>▶</Btn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-1">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => (
          <div key={l} className="px-2 py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const es = map.get(key) || [];
          const isCurMonth = day.month() === cursor.month();
          return (
            <button
              key={key}
              onClick={() => onDayClick?.({ date: key, events: es })}
              className={`border rounded-lg p-2 text-left min-h-[64px] ${isCurMonth ? "bg-white" : "bg-gray-50 text-gray-500"}`}
            >
              <div className="text-[11px] mb-1">{day.format("D")}</div>
              <div className="flex flex-wrap gap-1">
                {es.slice(0, 3).map((ev, i) => (
                  <span key={i} className="px-1 rounded bg-blue-100 text-blue-700 text-[10px]">
                    {ev.name || ev.equipment_name || ev.equipment_id}
                  </span>
                ))}
                {es.length > 3 && <span className="text-[10px] text-gray-500">+{es.length - 3}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Page principale ATEX ----------------------------- */
export default function Atex() {
  console.log("[Atex.jsx] Entering Atex");
  // Onglets
  const [tab, setTab] = useState("controls");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Liste équipements
  const [items, setItems] = useState([]);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [loading, setLoading] = useState(false);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Filtres
  const [filtersOpen, setFiltersOpen] = useState(false);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [q, setQ] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [status, setStatus] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [building, setBuilding] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [zone, setZone] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [compliance, setCompliance] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Édition
  const [drawerOpen, setDrawerOpen] = useState(false);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [editing, setEditing] = useState(null);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // PJ list
  const [files, setFiles] = useState([]);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Calendrier
  const [calendar, setCalendar] = useState({ events: [] });
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Toast
  const [toast, setToast] = useState("");
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  // Plans
  const [plans, setPlans] = useState([]);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [mapsLoading, setMapsLoading] = useState(false);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  const [selectedPlan, setSelectedPlan] = useState(null);
  console.log("[Atex.jsx] State change in Atex: " + JSON.stringify(arguments));
  /* ----------------------------- Helpers ----------------------------- */
  async function reload() {
    console.log("[Atex.jsx] Entering reload");
    setLoading(true);
    console.log("[Atex.jsx] State change in reload: " + JSON.stringify(arguments));
    try {
      const res = await api.atex.listEquipments({
        q,
        status,
        building,
        zone,
        compliance,
      });
      console.log("[Atex.jsx] API call in reload: " + JSON.stringify(this));
      setItems(Array.isArray(res?.items) ? res.items : []);
      console.log("[Atex.jsx] State change in reload: " + JSON.stringify(arguments));
    } catch (e) {
      console.error(e);
      setItems([]);
      console.log("[Atex.jsx] State change in reload: " + JSON.stringify(arguments));
    } finally {
      setLoading(false);
      console.log("[Atex.jsx] State change in reload: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting reload");
  }

  async function reloadCalendar() {
    console.log("[Atex.jsx] Entering reloadCalendar");
    try {
      const cal = await api.atex.calendar?.();
      console.log("[Atex.jsx] API call in reloadCalendar: " + JSON.stringify(this));
      if (Array.isArray(cal?.events)) {
        setCalendar({ events: cal.events });
        console.log("[Atex.jsx] State change in reloadCalendar: " + JSON.stringify(arguments));
        return;
      }
    } catch {}
    const evts = (items || [])
      .filter((it) => it?.next_check_date)
      .map((it) => ({
        date: dayjs(it.next_check_date).format("YYYY-MM-DD"),
        equipment_id: it.id,
        name: it.name,
      }));
    setCalendar({ events: evts });
    console.log("[Atex.jsx] State change in reloadCalendar: " + JSON.stringify(arguments));
    console.log("[Atex.jsx] Exiting reloadCalendar");
  }

  async function reloadFiles(equipId) {
    console.log("[Atex.jsx] Entering reloadFiles: " + equipId);
    if (!equipId) return;
    try {
      const res = await api.atex.listFiles(equipId).catch(() => ({ items: [] }));
      console.log("[Atex.jsx] API call in reloadFiles: " + JSON.stringify(this));
      setFiles(Array.isArray(res?.items) ? res.items : []);
      console.log("[Atex.jsx] State change in reloadFiles: " + JSON.stringify(arguments));
    } catch {
      setFiles([]);
      console.log("[Atex.jsx] State change in reloadFiles: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting reloadFiles");
  }

  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 350);
    return () => clearTimeout(t);
  }, [q, status, building, zone, compliance]);
  useEffect(() => {
    reloadCalendar();
  }, [items]);

  function openEdit(equipment) {
    console.log("[Atex.jsx] Entering openEdit: " + JSON.stringify(equipment));
    // propager zonages issus du plan si fournis via onOpenEquipment({ zones: {...} })
    const merged = {
      ...equipment,
      zoning_gas: equipment?.zones?.zoning_gas ?? equipment?.zoning_gas ?? null,
      zoning_dust: equipment?.zones?.zoning_dust ?? equipment?.zoning_dust ?? null,
    };
    setEditing(merged);
    console.log("[Atex.jsx] State change in openEdit: " + JSON.stringify(arguments));
    setDrawerOpen(true);
    console.log("[Atex.jsx] State change in openEdit: " + JSON.stringify(arguments));
    if (merged?.id) reloadFiles(merged.id);
    console.log("[Atex.jsx] Exiting openEdit");
  }
  function closeEdit() {
    console.log("[Atex.jsx] Entering closeEdit");
    setEditing(null);
    console.log("[Atex.jsx] State change in closeEdit: " + JSON.stringify(arguments));
    setFiles([]);
    console.log("[Atex.jsx] State change in closeEdit: " + JSON.stringify(arguments));
    setDrawerOpen(false);
    console.log("[Atex.jsx] State change in closeEdit: " + JSON.stringify(arguments));
    console.log("[Atex.jsx] Exiting closeEdit");
  }

  async function saveBase() {
    console.log("[Atex.jsx] Entering saveBase");
    if (!editing) return;
    const payload = {
      name: editing.name || "",
      building: editing.building || "",
      zone: editing.zone || "",
      equipment: editing.equipment || "",
      sub_equipment: editing.sub_equipment || "",
      type: editing.type || "",
      manufacturer: editing.manufacturer || "",
      manufacturer_ref: editing.manufacturer_ref || "",
      atex_mark_gas: editing.atex_mark_gas || null,
      atex_mark_dust: editing.atex_mark_dust || null,
      comment: editing.comment || "",
      status: editing.status || STATUS.A_FAIRE,
      installed_at: editing.installed_at || editing.installation_date || null,
      next_check_date: editing.next_check_date || null,
      zoning_gas: editing.zoning_gas ?? null,
      zoning_dust: editing.zoning_dust ?? null,
    };
    try {
      if (editing.id) {
        await api.atex.updateEquipment(editing.id, payload);
        console.log("[Atex.jsx] API call in saveBase: " + JSON.stringify(this));
      } else {
        const created = await api.atex.createEquipment(payload);
        console.log("[Atex.jsx] API call in saveBase: " + JSON.stringify(this));
        const id = created?.id || created?.equipment?.id;
        if (id) setEditing({ ...(editing || {}), id });
        console.log("[Atex.jsx] State change in saveBase: " + JSON.stringify(arguments));
      }
      await reload();
      console.log("[Atex.jsx] API call in saveBase: " + JSON.stringify(this));
      setToast("Fiche enregistrée ✅");
      console.log("[Atex.jsx] State change in saveBase: " + JSON.stringify(arguments));
    } catch (e) {
      console.error(e);
      setToast("Erreur enregistrement");
      console.log("[Atex.jsx] State change in saveBase: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting saveBase");
  }

  async function deleteEquipment() {
    console.log("[Atex.jsx] Entering deleteEquipment");
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement cet équipement ATEX ? Cette action est irréversible.");
    if (!ok) return;
    await api.atex.removeEquipment(editing.id);
    console.log("[Atex.jsx] API call in deleteEquipment: " + JSON.stringify(this));
    closeEdit();
    await reload();
    console.log("[Atex.jsx] API call in deleteEquipment: " + JSON.stringify(this));
    console.log("[Atex.jsx] Exiting deleteEquipment");
  }

  /* ----------------------------- Photos / pièces jointes ----------------------------- */
  async function uploadMainPhoto(file) {
    console.log("[Atex.jsx] Entering uploadMainPhoto");
    if (!editing?.id || !file) return;
    await api.atex.uploadPhoto(editing.id, file);
    console.log("[Atex.jsx] API call in uploadMainPhoto: " + JSON.stringify(this));
    await reloadFiles(editing.id);
    await reload();
    console.log("[Atex.jsx] API call in uploadMainPhoto: " + JSON.stringify(this));
    setToast("Photo mise à jour ✅");
    console.log("[Atex.jsx] State change in uploadMainPhoto: " + JSON.stringify(arguments));
    console.log("[Atex.jsx] Exiting uploadMainPhoto");
  }
  async function uploadAttachments(filesArr) {
    console.log("[Atex.jsx] Entering uploadAttachments");
    if (!editing?.id || !filesArr?.length) return;
    await api.atex.uploadAttachments(editing.id, filesArr);
    console.log("[Atex.jsx] API call in uploadAttachments: " + JSON.stringify(this));
    await reloadFiles(editing.id);
    setToast(filesArr.length > 1 ? "Fichiers ajoutés ✅" : "Fichier ajouté ✅");
    console.log("[Atex.jsx] State change in uploadAttachments: " + JSON.stringify(arguments));
    console.log("[Atex.jsx] Exiting uploadAttachments");
  }

  /* ----------------------------- IA ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    console.log("[Atex.jsx] Entering analyzeFromPhotos");
    const list = Array.from(filesLike || []);
    if (!list.length) return;
    try {
      const res = await api.atex.analyzePhotoBatch(list);
      console.log("[Atex.jsx] API call in analyzeFromPhotos: " + JSON.stringify(this));
      const s = res?.extracted || res || {};
      setEditing((x) => ({
        ...(x || {}),
        manufacturer: x?.manufacturer || s.manufacturer || "",
        manufacturer_ref: x?.manufacturer_ref || s.manufacturer_ref || "",
        atex_mark_gas: x?.atex_mark_gas || s.atex_mark_gas || "",
        atex_mark_dust: x?.atex_mark_dust || s.atex_mark_dust || "",
        type: x?.type || s.type || "",
      }));
      console.log("[Atex.jsx] State change in analyzeFromPhotos: " + JSON.stringify(arguments));
      setToast("Analyse photos terminée ✅");
      console.log("[Atex.jsx] State change in analyzeFromPhotos: " + JSON.stringify(arguments));
    } catch (e) {
      console.error(e);
      setToast("Analyse photos indisponible");
      console.log("[Atex.jsx] State change in analyzeFromPhotos: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting analyzeFromPhotos");
  }
  async function analyzeCompliance() {
    console.log("[Atex.jsx] Entering analyzeCompliance");
    if (!editing) return;
    try {
      const body = {
        atex_mark_gas: editing.atex_mark_gas || "",
        atex_mark_dust: editing.atex_mark_dust || "",
        target_gas: editing.zoning_gas ?? null,
        target_dust: editing.zoning_dust ?? null,
      };
      const res =
        (api.atex.assessConformity && (await api.atex.assessConformity(body))) ||
        (api.atex.aiAnalyze && (await api.atex.aiAnalyze(body)));
      console.log("[Atex.jsx] API call in analyzeCompliance: " + JSON.stringify(this));
      await reload();
      console.log("[Atex.jsx] API call in analyzeCompliance: " + JSON.stringify(this));
      setToast(res?.message || res?.rationale || "Analyse conformité OK ✅");
      console.log("[Atex.jsx] State change in analyzeCompliance: " + JSON.stringify(arguments));
    } catch (e) {
      console.error(e);
      setToast("Analyse conformité indisponible");
      console.log("[Atex.jsx] State change in analyzeCompliance: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting analyzeCompliance");
  }

  /* ----------------------------- Rappels planifiés ----------------------------- */
  function ensureNextCheckFromInstall(editingLocal) {
    console.log("[Atex.jsx] Entering ensureNextCheckFromInstall");
    const it = editingLocal || editing;
    if (!it) return;
    if ((it.installed_at || it.installation_date) && !it.next_check_date) {
      const base = it.installed_at || it.installation_date;
      const next = dayjs(base).add(90, "day");
      setEditing({ ...it, installed_at: base, next_check_date: next.format("YYYY-MM-DD") });
      console.log("[Atex.jsx] State change in ensureNextCheckFromInstall: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting ensureNextCheckFromInstall");
  }

  /* ----------------------------- Plans ----------------------------- */
  async function loadPlans() {
    console.log("[Atex.jsx] Entering loadPlans");
    setMapsLoading(true);
    console.log("[Atex.jsx] State change in loadPlans: " + JSON.stringify(arguments));
    try {
      const r = await api.atexMaps.listPlans();
      console.log("[Atex.jsx] API call in loadPlans: " + JSON.stringify(this));
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
      console.log("[Atex.jsx] State change in loadPlans: " + JSON.stringify(arguments));
    } finally {
      setMapsLoading(false);
      console.log("[Atex.jsx] State change in loadPlans: " + JSON.stringify(arguments));
    }
    console.log("[Atex.jsx] Exiting loadPlans");
  }
  useEffect(() => {
    if (tab === "plans") loadPlans();
  }, [tab]);

  /* ----------------------------- UI ----------------------------- */
  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "controls" ? "primary" : "ghost"} onClick={() => setTab("controls")}>📋 Contrôles</Btn>
        <Btn variant={tab === "calendar" ? "primary" : "ghost"} onClick={() => setTab("calendar")}>📅 Calendrier</Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>🗺️ Plans</Btn>
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>⚙️ Paramètres</Btn>
      </div>
    </div>
  );

  console.log("[Atex.jsx] Exiting Atex");
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Équipements ATEX</h1>
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
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / marquage / ref…)" />
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
            <Input value={zone} onChange={setZone} placeholder="Zone / Étage" />
            <Select
              value={compliance}
              onChange={setCompliance}
              options={[
                { value: "", label: "Tous états de conformité" },
                { value: "conforme", label: "Conforme" },
                { value: "non_conforme", label: "Non conforme" },
                { value: "na", label: "N/A" },
              ]}
              placeholder="Conformité"
            />
          </div>
          <div className="flex gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setQ("");
                setStatus("");
                setBuilding("");
                setZone("");
                setCompliance("");
              }}
            >
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}

      {/* --------- Onglet Contrôles --------- */}
      {tab === "controls" && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[12px] z-20 bg-gray-50/90 backdrop-blur supports-[backdrop-filter]:bg-gray-50/70">
                <tr className="text-left border-b">
                  <th className="px-4 py-3 font-semibold text-gray-700">Équipement</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Localisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Conformité</th>
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
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">Aucun équipement.</td>
                  </tr>
                )}
                {!loading &&
                  items.map((it, idx) => (
                    <tr
                      key={it.id}
                      className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}
                    >
                      <td className="px-4 py-3 min-w-[260px]">
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                            {it.photo_url ? (
                              <img src={api.atex.photoUrl(it.id)} alt={it.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-gray-500 p-1 text-center">
                                Photo à<br />prendre
                              </span>
                            )}
                          </div>
                          <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(it)}>
                            {it.name || it.type || "Équipement"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(it.building || "—") +
                          " • " +
                          (it.zone || "—") +
                          (it.equipment ? ` • ${it.equipment}` : "") +
                          (it.sub_equipment ? ` • ${it.sub_equipment}` : "")}
                      </td>
                      <td className="px-4 py-3">
                        {it.compliance_state === "conforme" ? (
                          <Badge color="green">Conforme</Badge>
                        ) : it.compliance_state === "non_conforme" ? (
                          <Badge color="red">Non conforme</Badge>
                        ) : (
                          <Badge>—</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={statusColor(it.status)}>{statusLabel(it.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Btn variant="ghost" onClick={() => openEdit(it)}>Ouvrir</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {loading && <div className="p-4 text-gray-500">Chargement…</div>}
            {!loading && items.length === 0 && <div className="p-4 text-gray-500">Aucun équipement.</div>}
            {!loading &&
              items.map((it) => (
                <div key={it.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                        {it.photo_url ? (
                          <img src={api.atex.photoUrl(it.id)} alt={it.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[11px] text-gray-500 p-1 text-center">
                            Photo à<br />prendre
                          </span>
                        )}
                      </div>
                      <div>
                        <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(it)}>
                          {it.name || it.type || "Équipement"}
                        </button>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {it.building || "—"} • {it.zone || "—"} {it.equipment ? `• ${it.equipment}` : ""}{" "}
                          {it.sub_equipment ? `• ${it.sub_equipment}` : ""}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {it.compliance_state === "conforme" ? (
                            <Badge color="green">Conforme</Badge>
                          ) : it.compliance_state === "non_conforme" ? (
                            <Badge color="red">Non conforme</Badge>
                          ) : (
                            <Badge>—</Badge>
                          )}
                          <span className="text-xs text-gray-500">
                            Prochain contrôle: {it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge color={statusColor(it.status)}>{statusLabel(it.status)}</Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn variant="ghost" onClick={() => openEdit(it)}>Ouvrir</Btn>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* --------- Onglet Calendrier --------- */}
      {tab === "calendar" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <MonthCalendar
            events={calendar.events}
            onDayClick={({ events }) => {
              const first = events?.[0];
              if (!first?.equipment_id) return;
              const it = items.find((x) => x.id === first.equipment_id);
              if (it) openEdit(it);
            }}
          />
        </div>
      )}

      {/* --------- Onglet Plans --------- */}
      {tab === "plans" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold">Plans PDF</div>
            <AtexZipImport
              disabled={mapsLoading}
              onDone={async () => {
                setToast("Plans importés ✅");
                await loadPlans();
              }}
            />
          </div>

          <PlanCards
            plans={plans}
            onRename={async (plan, name) => {
              await api.atexMaps.renamePlan(plan.logical_name, name);
              await loadPlans();
            }}
            onPick={setSelectedPlan}
          />

          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold truncate pr-3">
                  {selectedPlan.display_name || selectedPlan.logical_name}
                </div>
                <div className="flex items-center gap-2">
                  <Btn variant="ghost" onClick={() => setSelectedPlan(null)}>Fermer le plan</Btn>
                </div>
              </div>

              {/* FIX: Ajout bâtiment/zone pour plan */}
              <div className="mt-4 space-y-2">
                <Labeled label="Bâtiment du plan">
                  <Input value={selectedPlan.building || ""} onChange={(v) => {
                    const newName = `Bâtiment: ${v} - Zone: ${selectedPlan.zone || ""}`;
                    api.atexMaps.renamePlan(selectedPlan.logical_name, newName);
                  }} />
                </Labeled>
                <Labeled label="Zone du plan">
                  <Input value={selectedPlan.zone || ""} onChange={(v) => {
                    const newName = `Bâtiment: ${selectedPlan.building || ""} - Zone: ${v}`;
                    api.atexMaps.renamePlan(selectedPlan.logical_name, newName);
                  }} />
                </Labeled>
              </div>

              <AtexMap plan={selectedPlan} onOpenEquipment={openEdit} />
            </div>
          )}
        </div>
      )}

      {/* --------- Onglet Paramètres --------- */}
      {tab === "settings" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
          <div className="text-sm text-gray-600">
            Paramétrage ATEX (placeholder). On peut y mettre des gabarits ou préférences.
          </div>
        </div>
      )}

      {/* --------- Drawer Édition --------- */}
      {drawerOpen && editing && (
        <Drawer title={`ATEX • ${editing.name || "nouvel équipement"}`} onClose={closeEdit}>
          <div className="space-y-4">

            {/* 🔥 Ajout & Analyse IA tout en haut de la fiche */}
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
                  <Btn variant="subtle" onClick={analyzeCompliance}>Vérifier conformité (IA)</Btn>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Conseils : photo nette de la plaque (gaz/poussière). Le zonage vient des zones du plan, pas de la plaque.
              </div>
            </div>

            {/* Métadonnées principales */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Nom">
                <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
              </Labeled>
              <Labeled label="Type (interrupteur, luminaire, etc.)">
                <Input value={editing.type || ""} onChange={(v) => setEditing({ ...editing, type: v })} />
              </Labeled>
              <Labeled label="Fabricant">
                <Input value={editing.manufacturer || ""} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
              </Labeled>
              <Labeled label="Référence fabricant">
                <Input value={editing.manufacturer_ref || ""} onChange={(v) => setEditing({ ...editing, manufacturer_ref: v })} />
              </Labeled>
              <Labeled label="Marquage ATEX (gaz)">
                <Input value={editing.atex_mark_gas || ""} onChange={(v) => setEditing({ ...editing, atex_mark_gas: v })} />
              </Labeled>
              <Labeled label="Marquage ATEX (poussière)">
                <Input value={editing.atex_mark_dust || ""} onChange={(v) => setEditing({ ...editing, atex_mark_dust: v })} />
              </Labeled>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Bâtiment">
                <Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} />
              </Labeled>
              <Labeled label="Zone (plan)">
                <Input value={editing.zone || ""} onChange={(v) => setEditing({ ...editing, zone: v })} />
              </Labeled>
              <Labeled label="Équipement (macro)">
                <Input value={editing.equipment || ""} onChange={(v) => setEditing({ ...editing, equipment: v })} />
              </Labeled>
              <Labeled label="Sous-Équipement (depuis zones tracées)">
                <Input value={editing.sub_equipment || ""} onChange={(v) => setEditing({ ...editing, sub_equipment: v })} />
              </Labeled>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Zonage gaz (0 / 1 / 2)">
                <Input
                  value={editing.zoning_gas ?? ""}
                  placeholder={editing.zones?.zoning_gas ?? ""}
                  onChange={(v) => setEditing({ ...editing, zoning_gas: v === "" ? null : Number(v) })}
                />
              </Labeled>
              <Labeled label="Zonage poussière (20 / 21 / 22)">
                <Input
                  value={editing.zoning_dust ?? ""}
                  placeholder={editing.zones?.zoning_dust ?? ""}
                  onChange={(v) => setEditing({ ...editing, zoning_dust: v === "" ? null : Number(v) })}
                />
              </Labeled>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Date d’installation">
                <Input
                  type="date"
                  value={asDateInput(editing.installed_at || editing.installation_date)}
                  onChange={(v) => {
                    const next = { ...editing, installed_at: v };
                    setEditing(next);
                    ensureNextCheckFromInstall(next);
                  }}
                />
              </Labeled>
              <Labeled label="Prochain contrôle">
                <Input
                  type="date"
                  value={asDateInput(editing.next_check_date)}
                  onChange={(v) => setEditing({ ...editing, next_check_date: v })}
                />
              </Labeled>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Statut</span>
                <Badge color={statusColor(editing.status)}>{statusLabel(editing.status)}</Badge>
                <span className="text-sm text-gray-600">• Conformité</span>
                {editing.compliance_state === "conforme" ? (
                  <Badge color="green">Conforme</Badge>
                ) : editing.compliance_state === "non_conforme" ? (
                  <Badge color="red">Non conforme</Badge>
                ) : (
                  <Badge>—</Badge>
                )}
              </div>
              <div className="text-sm text-gray-600">Alerte: 90 jours avant la date de contrôle</div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Btn variant="ghost" onClick={saveBase}>Enregistrer la fiche</Btn>
              {editing?.id && <Btn variant="danger" onClick={deleteEquipment}>Supprimer</Btn>}
            </div>

            {/* Photo principale */}
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
                <div className="w-40 h-40 rounded-xl border overflow-hidden bg-gray-50 flex items-center justify-center">
                  {editing.photo_url ? (
                    <img src={api.atex.photoUrl(editing.id)} alt="photo" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>
                  )}
                </div>
              </div>
            )}

            {/* Pièces jointes & photos (CONSERVÉ ICI) */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes & photos</div>
                  <div className="flex items-center gap-2">
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
                </div>

                {/* Liste des pièces jointes */}
                <div className="mt-3 space-y-2">
                  {files.length === 0 && (
                    <div className="text-xs text-gray-500">Aucune pièce jointe.</div>
                  )}
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm border rounded-lg px-2 py-1">
                      <a
                        href={f.url || `${API_BASE}/api/atex/files/${encodeURIComponent(f.id)}/download`}
                        target="_blank" rel="noreferrer"
                        className="text-blue-700 hover:underline truncate max-w-[70%]"
                        title={f.name || f.filename}
                      >
                        {f.name || f.filename || `Fichier ${f.id}`}
                      </a>
                      <button
                        className="text-rose-600 hover:underline"
                        onClick={async () => {
                          await api.atex.deleteFile(f.id);
                          reloadFiles(editing.id);
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  Glisser-déposer supporté dans l’onglet Plans lors de la création in situ.
                </div>
              </div>
            )}

            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">Commentaire</div>
              <Textarea
                rows={3}
                value={editing.comment || ""}
                onChange={(v) => setEditing({ ...editing, comment: v })}
                placeholder="Notes libres…"
              />
            </div>
          </div>
        </Drawer>
      )}
    </section>
  );
}

/* ----------------------------- Sous-composants locaux ----------------------------- */

function AtexZipImport({ disabled, onDone }) {
  console.log("[Atex.jsx] Entering AtexZipImport");
  const inputRef = useRef(null);
  console.log("[Atex.jsx] Exiting AtexZipImport");
  return (
    <div className="flex items-center gap-2">
      <Btn variant="ghost" onClick={() => inputRef.current?.click()} disabled={disabled}>
        📦 Import ZIP de plans
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
  console.log("[Atex.jsx] Entering PlanCards");
  console.log("[Atex.jsx] Exiting PlanCards");
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
  console.log("[Atex.jsx] Entering PlanCard");
  const [edit, setEdit] = useState(false);
  console.log("[Atex.jsx] State change in PlanCard: " + JSON.stringify(arguments));
  const [name, setName] = useState(plan.display_name || plan.logical_name || "");
  console.log("[Atex.jsx] State change in PlanCard: " + JSON.stringify(arguments));
  console.log("[Atex.jsx] Exiting PlanCard");
  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center text-gray-500">
          <div className="text-4xl leading-none">📄</div>
          <div className="text-[11px] mt-1">PDF</div>
        </div>
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
