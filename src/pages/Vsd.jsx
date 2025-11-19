// src/pages/Vsd.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import "../styles/vsd-map.css";
import { api, API_BASE } from "../lib/api.js";
import VsdMap from "./Vsd-map.jsx";

/* ----------------------------- UI utils ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost:
      "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger:
      "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success:
      "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle:
      "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed",
    warn:
      "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed",
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
/* Drawer + Toast */
function Drawer({ title, children, onClose, dirty = false }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") confirmClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  useEffect(() => {
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
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

/* ---- Dates pour <input type="date"> ---- */
function asDateInput(v) {
  if (!v) return "";
  const d = dayjs(v);
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
  if (s === STATUS.A_FAIRE) return "green";
  if (s === STATUS.EN_COURS) return "orange";
  if (s === STATUS.EN_RETARD) return "red";
  if (s === STATUS.FAIT) return "blue";
  return "gray";
}
function statusLabel(s) {
  if (s === STATUS.A_FAIRE) return "À faire";
  if (s === STATUS.EN_COURS) return "≤90j";
  if (s === STATUS.EN_RETARD) return "En retard";
  if (s === STATUS.FAIT) return "Fait";
  return s || "—";
}

/* ----------------------------- Mini calendrier ----------------------------- */
function MonthCalendar({ events = [], onDayClick }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf("month"));
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

/* ----------------------------- Page principale VSD ----------------------------- */
export default function Vsd() {
  // Onglets
  const [tab, setTab] = useState("controls");

  // Liste équipements
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filtres
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [building, setBuilding] = useState("");
  const [zone, setZone] = useState("");

  // Édition
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const initialRef = useRef(null); // snapshot pour dirty check

  // PJ list
  const [files, setFiles] = useState([]);

  // Historique des contrôles
  const [history, setHistory] = useState([]);

  // Calendrier
  const [calendar, setCalendar] = useState({ events: [] });

  // Toast
  const [toast, setToast] = useState("");

  // Plans
  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex] = useState(0);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Mode placement (nouvel équipement)
  const [pendingPlacement, setPendingPlacement] = useState(null);
  const createdIdRef = useRef(null);

  // Indicateur global
  const [globalLoading, setGlobalLoading] = useState(false);

  /* ----------------------------- Helpers ----------------------------- */
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
    setGlobalLoading(true);
    setLoading(true);
    try {
      const res = await api.vsd.listEquipments({
        q, status, building, zone,
      });
      setItems(normalizeListResponse(res));
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
      setGlobalLoading(false);
    }
  }

  async function reloadCalendar() {
    try {
      const cal = await api.vsd.calendar?.();
      if (Array.isArray(cal?.events)) {
        setCalendar({ events: cal.events });
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
  }

  // Fichiers
  async function reloadFiles(equipId) {
    if (!equipId) return;
    try {
      const res = await api.vsd.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url:
              f.download_url ||
              f.inline_url ||
              `${API_BASE}/api/vsd/files/${encodeURIComponent(f.id)}/download`,
          }))
        : Array.isArray(res?.items)
        ? res.items
        : [];
      setFiles(arr);
    } catch (e) {
      console.error(e);
      setFiles([]);
    }
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => { triggerReloadDebounced(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q, status, building, zone]);
  useEffect(() => { reloadCalendar(); }, [items]);

  /* ----------------------------- Édition ----------------------------- */
  const mergeZones = (raw) => {
    if (!raw) return raw;
    const clean = { ...raw };
    // Nettoyage des champs texte (toujours string)
    for (const field of ["building", "zone", "equipment", "sub_equipment"]) {
      if (typeof clean[field] === "object" && clean[field] !== null) {
        clean[field] = clean[field].name || clean[field].equipment || clean[field].id || "";
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
        // Données fraîches + historique + fichiers
        const res = await api.vsd.getEquipment(base.id);
        const fresh = mergeZones(res?.equipment || res || {});
        setEditing((cur) => {
          const next = { ...(cur || {}), ...fresh };
          initialRef.current = next;
          return next;
        });

        const hist = await api.vsd.getEquipmentHistory?.(base.id);
        setHistory(Array.isArray(hist?.checks) ? hist.checks : Array.isArray(hist) ? hist : []);

        await reloadFiles(base.id);
      } catch (err) {
        console.warn("[VSD] Erreur rechargement équipement :", err);
        setHistory([]);
        setFiles([]);
      }
    }
  }

  function closeEdit() {
    setEditing(null);
    setFiles([]);
    setHistory([]);
    delete window._vsdReload;
    setDrawerOpen(false);
    initialRef.current = null;
  }

  function isDirty() {
    if (!editing || !initialRef.current) return false;
    const A = editing;
    const B = initialRef.current;
    const keys = [
      "name", "building", "zone",
      "equipment", "sub_equipment",
      "type", "manufacturer", "manufacturer_ref",
      "power_kw", "voltage", "current_nominal", "ip_rating",
      "comment", "installed_at", "next_check_date",
    ];
    return keys.some((k) => String(A?.[k] ?? "") !== String(B?.[k] ?? ""));
  }
  const dirty = isDirty();

  async function saveBase() {
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
      power_kw: editing.power_kw ?? null,
      voltage: editing.voltage || "",
      current_nominal: editing.current_nominal ?? null,
      ip_rating: editing.ip_rating || "",
      comment: editing.comment || "",
      installed_at: editing.installed_at || null,
      next_check_date: editing.next_check_date || null,
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
      await api.vsd.removeEquipment(editing.id);
      closeEdit();
      await reload();
      setMapRefreshTick((t) => t + 1);
      setToast("Équipement supprimé");
    } catch (e) {
      console.error(e);
      setToast("Suppression impossible");
    }
  }

  /* ----------------------------- Photos / fichiers ----------------------------- */
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
      await api.vsd.uploadAttachments(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch (e) {
      console.error(e);
      setToast("Échec upload fichiers");
    }
  }

  /* ----------------------------- Analyse photo (facultatif) ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;
    try {
      const res = await api.vsd.analyzePhotoBatch?.(list);
      const s = res?.extracted || res || {};
      setEditing((x) => {
        const safe = { ...x };
        const applyIfValid = (field, value) => {
          if (value && typeof value === "string" && value.trim().length > 2 && value.trim() !== safe[field]) {
            safe[field] = value.trim();
          }
        };
        applyIfValid("manufacturer", s.manufacturer);
        applyIfValid("manufacturer_ref", s.manufacturer_ref);
        applyIfValid("type", s.type);
        return safe;
      });
      setToast("Analyse des photos terminée");
    } catch (e) {
      console.error("[VSD] Analyse photos indisponible :", e);
      setToast("Analyse photos indisponible");
    }
  }

  /* ----------------------------- Plans ----------------------------- */
  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await api.vsdMaps.listPlans();
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally {
      setMapsLoading(false);
    }
  }
  useEffect(() => { if (tab === "plans") loadPlans(); }, [tab]);
  useEffect(() => { if (tab !== "plans" && selectedPlan) setSelectedPlan(null); }, [tab]);
  useEffect(() => {
    if (!mapsLoading && selectedPlan && !plans.find(p => p.logical_name === selectedPlan.logical_name)) {
      setSelectedPlan(null);
    }
  }, [plans, mapsLoading, selectedPlan]);

  function applyEquipMetaLocally(id, patch) {
    if (!id || !patch) return;
    setItems((old) => (old || []).map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setEditing((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }

  async function createAndPlaceOnPlan() {
    if (!selectedPlan) return;
    try {
      const payload = {
        name: "Nouveau VSD",
        equipment: selectedPlan.display_name || selectedPlan.logical_name || "",
        type: "Variateur de fréquence",
      };
      const created = await api.vsd.createEquipment(payload);
      const id = created?.equipment?.id || created?.id;
      if (!id) throw new Error("Création VSD: ID manquant");
      createdIdRef.current = id;
      // passe la carte en mode placement
      setPendingPlacement({ equipment_id: id });
      setToast("Clique sur le plan pour placer le variateur");
    } catch (e) {
      console.error(e);
      setToast("Création impossible");
    }
  }

  /* ----------------------------- UI ----------------------------- */
  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "controls" ? "primary" : "ghost"} onClick={() => setTab("controls")}>Contrôles</Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>Plans</Btn>
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>Paramètres</Btn>
      </div>
    </div>
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      {/* SPINNER GLOBAL */}
      {globalLoading && (
        <div className="fixed inset-0 bg-white/70 flex items-center justify-center z-[5000] backdrop-blur-sm">
          <div className="text-sm text-gray-600">Mise à jour en cours…</div>
        </div>
      )}

      <StickyTabs />

      {/* --------- Onglet Contrôles --------- */}
      {tab === "controls" && (
        <div className="space-y-4">
          {/* Filtres */}
          <div className="bg-white rounded-2xl border shadow-sm p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Variateurs de fréquence</div>
              <Btn variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>
                {filtersOpen ? "Masquer les filtres" : "Filtres"}
              </Btn>
            </div>
            {filtersOpen && (
              <div className="mt-3 grid sm:grid-cols-5 gap-2">
                <Input value={q} onChange={setQ} placeholder="Recherche…" />
                <Select
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "", label: "Statut — Tous" },
                    { value: STATUS.A_FAIRE, label: "À faire" },
                    { value: STATUS.EN_COURS, label: "≤ 90 jours" },
                    { value: STATUS.EN_RETARD, label: "En retard" },
                    { value: STATUS.FAIT, label: "Fait" },
                  ]}
                />
                <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
                <Input value={zone} onChange={setZone} placeholder="Zone" />
                <div className="flex items-center gap-2">
                  <Btn onClick={reload}>Appliquer</Btn>
                  <Btn variant="ghost" onClick={() => { setQ(""); setStatus(""); setBuilding(""); setZone(""); }}>
                    Réinitialiser
                  </Btn>
                </div>
              </div>
            )}
          </div>

          {/* Tableau desktop */}
          <div className="hidden sm:block bg-white rounded-2xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left">Photo</th>
                  <th className="px-4 py-2 text-left">Nom</th>
                  <th className="px-4 py-2 text-left">Implantation</th>
                  <th className="px-4 py-2 text-left">Type & Constructeur</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Prochain contrôle</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-6 text-gray-500">Chargement…</td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-gray-500">Aucun variateur.</td></tr>
                )}
                {!loading && items.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                        {it.photo_url ? (
                          <img src={api.vsd.photoUrl(it.id)} alt={it.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[11px] text-gray-500 p-1 text-center">Photo à<br/>prendre</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(it)}>
                        {it.name || it.type || "VSD"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(it.building || "—")} • {(it.zone || "—")} {it.equipment ? `• ${it.equipment}` : ""} {it.sub_equipment ? `• ${it.sub_equipment}` : ""}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(it.type || "—")} {it.manufacturer ? `• ${it.manufacturer}` : ""} {it.manufacturer_ref ? `• ${it.manufacturer_ref}` : ""}
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
            {!loading && items.length === 0 && <div className="p-4 text-gray-500">Aucun variateur.</div>}
            {!loading && items.map((it) => (
              <div key={it.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                      {it.photo_url ? (
                        <img src={api.vsd.photoUrl(it.id)} alt={it.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[11px] text-gray-500 p-1 text-center">Photo à<br/>prendre</span>
                      )}
                    </div>
                    <div>
                      <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(it)}>
                        {it.name || it.type || "VSD"}
                      </button>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {it.building || "—"} • {it.zone || "—"} {it.equipment ? `• ${it.equipment}` : ""} {it.sub_equipment ? `• ${it.sub_equipment}` : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
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

          {/* Calendrier synthèse */}
          <div className="bg-white rounded-2xl border shadow-sm p-3">
            <div className="font-semibold mb-2">Échéances à venir</div>
            <MonthCalendar
              events={calendar.events}
              onDayClick={({ date, events }) => {
                const ds = dayjs(date).format("DD/MM/YYYY");
                if (!events.length) { setToast(`Aucun contrôle le ${ds}`); return; }
                const names = events.map((e) => e.name || e.equipment_name || e.equipment_id).join(", ");
                setToast(`${events.length} contrôle(s) le ${ds} : ${names}`);
              }}
            />
          </div>
        </div>
      )}

      {/* --------- Onglet Plans --------- */}
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
              setMapRefreshTick((t) => t + 1);
            }}
          />

          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold truncate pr-3">
                  {selectedPlan.display_name || selectedPlan.logical_name}
                </div>
                <div className="flex items-center gap-2">
                  <Btn
                    className="whitespace-nowrap"
                    onClick={createAndPlaceOnPlan}
                  >
                    ＋ Ajouter un variateur sur ce plan
                  </Btn>
                  <Btn
                    variant="ghost"
                    onClick={() => {
                      setSelectedPlan(null);
                      setMapRefreshTick((t) => t + 1);
                    }}
                  >
                    Fermer le plan
                  </Btn>
                </div>
              </div>

              {/* Carte VSD */}
              <VsdMap
                key={`${selectedPlan.logical_name}:${mapRefreshTick}`}
                plan={selectedPlan}
                pageIndex={pageIndex}
                // Correction: la carte VSD attend onSelectTask (pas onOpenEquipment)
                onSelectTask={(p) => openEdit({ id: p.id, name: p.task_name || p.name })}
                // Mode placement
                pendingPlacement={pendingPlacement}
                onPlacementComplete={(equipmentId) => {
                  setPendingPlacement(null);
                  if (equipmentId && (!createdIdRef.current || equipmentId === createdIdRef.current)) {
                    openEdit({ id: equipmentId });
                  }
                  createdIdRef.current = null;
                  reload();
                  setToast("Position enregistrée sur le plan");
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* --------- Onglet Paramètres --------- */}
      {tab === "settings" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
          <div className="text-sm text-gray-600">
            Paramétrage VSD (fréquences de contrôle, gabarits d’inspection, etc.). 
            (Placeholders — peut rester vide si non utilisé.)
          </div>
        </div>
      )}

      {/* --------- Drawer Édition --------- */}
      {drawerOpen && editing && (
        <Drawer title={`VSD • ${editing.name || "nouvel équipement"}`} onClose={closeEdit} dirty={dirty}>
          <div className="space-y-4">
            {/* Photo */}
            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="font-semibold mb-2">Photo du variateur</div>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-32 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                    {editing.photo_url ? (
                      <img src={api.vsd.photoUrl(editing.id)} alt={editing.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-gray-500 p-1 text-center">Photo à<br/>prendre</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadMainPhoto(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="text-xs text-gray-500">Astuce : tu peux glisser une photo ici.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Identification & implantation */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Identification</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Nom">
                  <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="Ex: VSD Ligne A / Convoyeur 3" />
                </Labeled>
                <Labeled label="Type">
                  <Input value={editing.type || ""} onChange={(v) => setEditing({ ...editing, type: v })} placeholder="Ex: Variateur de fréquence" />
                </Labeled>
                <Labeled label="Bâtiment (depuis plan)">
                  <Input value={editing.building || ""} readOnly className="bg-gray-50 text-gray-600" title="Défini dans l'en-tête/les métadonnées du plan" />
                </Labeled>
                <Labeled label="Zone (depuis plan)">
                  <Input value={editing.zone || ""} readOnly className="bg-gray-50 text-gray-600" title="Défini dans l'en-tête/les métadonnées du plan" />
                </Labeled>
                <Labeled label="Équipement (macro)">
                  <Input value={editing.equipment || ""} onChange={(v) => setEditing({ ...editing, equipment: v })} placeholder="Nom du plan ou zone macro" />
                </Labeled>
                <Labeled label="Sous-Équipement">
                  <Input value={editing.sub_equipment || ""} onChange={(v) => setEditing({ ...editing, sub_equipment: v })} placeholder="Ex : Zone locale / cellule" />
                </Labeled>
              </div>
            </div>

            {/* Caractéristiques techniques */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Caractéristiques</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Fabricant">
                  <Input value={editing.manufacturer || ""} onChange={(v) => setEditing({ ...editing, manufacturer: v })} placeholder="Ex: Schneider, Danfoss…" />
                </Labeled>
                <Labeled label="Référence fabricant">
                  <Input value={editing.manufacturer_ref || ""} onChange={(v) => setEditing({ ...editing, manufacturer_ref: v })} placeholder="Ex: ATV320D11N4B" />
                </Labeled>
                <Labeled label="Puissance (kW)">
                  <Input value={editing.power_kw ?? ""} onChange={(v) => setEditing({ ...editing, power_kw: v === "" ? null : Number(v) })} type="number" step="0.1" min="0" placeholder="Ex: 11" />
                </Labeled>
                <Labeled label="Tension (V)">
                  <Input value={editing.voltage || ""} onChange={(v) => setEditing({ ...editing, voltage: v })} placeholder="Ex: 400 V" />
                </Labeled>
                <Labeled label="Courant nominal (A)">
                  <Input value={editing.current_nominal ?? ""} onChange={(v) => setEditing({ ...editing, current_nominal: v === "" ? null : Number(v) })} type="number" step="0.1" min="0" placeholder="Ex: 25" />
                </Labeled>
                <Labeled label="Indice de protection (IP)">
                  <Input value={editing.ip_rating || ""} onChange={(v) => setEditing({ ...editing, ip_rating: v })} placeholder="Ex: IP55" />
                </Labeled>
              </div>
            </div>

            {/* Échéances */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Échéances</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Date d’installation">
                  <Input value={asDateInput(editing.installed_at)} onChange={(v) => setEditing({ ...editing, installed_at: v })} type="date" />
                </Labeled>
                <Labeled label="Prochain contrôle (date)">
                  <Input value={asDateInput(editing.next_check_date)} onChange={(v) => setEditing({ ...editing, next_check_date: v })} type="date" />
                </Labeled>
              </div>
            </div>

            {/* Pièces jointes */}
            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="font-semibold mb-2">Pièces jointes</div>
                <input
                  type="file"
                  multiple
                  onChange={async (e) => {
                    const list = Array.from(e.target.files || []);
                    if (list.length) await uploadAttachments(list);
                    e.target.value = "";
                  }}
                />
                <div className="mt-2 space-y-1">
                  {files.length === 0 && <div className="text-xs text-gray-500">Aucune pièce jointe.</div>}
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm border rounded-lg px-2 py-1">
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate max-w-[70%]" title={f.name}>
                        {f.name}
                      </a>
                      <button className="text-rose-600 hover:underline" onClick={async () => { await api.vsd.deleteFile(f.id); reloadFiles(editing.id); }}>
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">Glisser-déposer supporté.</div>
              </div>
            )}

            {/* Historique des contrôles */}
            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="font-semibold mb-2">Historique des contrôles</div>
                {history.length === 0 && (
                  <div className="text-xs text-gray-500">Aucun contrôle enregistré.</div>
                )}
                {history.length > 0 && (
                  <div className="text-sm divide-y border rounded-lg">
                    {history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1">
                        <div>
                          <div className="font-medium">
                            {dayjs(h.date || h.checked_at).format("DD/MM/YYYY")}
                          </div>
                          <div className="text-xs text-gray-500">
                            {h.user_name || h.user_email || "—"}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">{h.result || h.note || ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Commentaire */}
            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">Commentaire</div>
              <Textarea rows={3} value={editing.comment || ""} onChange={(v) => setEditing({ ...editing, comment: v })} placeholder="Notes libres…" />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Btn onClick={saveBase}>Enregistrer</Btn>
                {editing?.id && (
                  <Btn variant="danger" onClick={deleteEquipment}>Supprimer</Btn>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" multiple onChange={(e) => analyzeFromPhotos(e.target.files)} />
                <span className="text-xs text-gray-500">Analyser (fabricant/réf.)</span>
              </div>
            </div>
          </div>
        </Drawer>
      )}
    </section>
  );
}

/* ----------------------------- Sous-composants locaux ----------------------------- */
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
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">
          {name}
        </div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>{name || "—"}</div>
            <div className="flex items-center gap-1">
              <button className="text-xs text-gray-600 hover:text-gray-900" onClick={() => setEdit(true)}>✏️</button>
              <Btn variant="subtle" onClick={() => onPick?.(plan)}>Ouvrir</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={name} onChange={setName} />
            <div className="flex gap-2">
              <Btn variant="subtle" onClick={async () => { await onRename?.(plan, name); setEdit(false); }} className="flex-1">✓</Btn>
              <Btn variant="ghost" onClick={() => { setName(plan.display_name || plan.logical_name || ""); setEdit(false); }} className="flex-1">✕</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
