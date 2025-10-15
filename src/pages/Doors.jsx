// src/pages/Doors.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";

/* -------- pdf.js (local, pas d’<embed>, pas de CDN) -------- */
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
    if (!name)  name  = localStorage.getItem("name")  || localStorage.getItem("user.name")  || null;

    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && (u?.name || u?.displayName)) name = String(u.name || u.displayName);
      } catch {}
    }
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
    if (base) {
      name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    }
  }
  email = email ? String(email).trim() : null;
  name  = name  ? String(name).trim()  : null;
  return { email, name };
}

function userHeaders() {
  const { email, name } = getIdentity();
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name)  h["X-User-Name"]  = name;
  return h;
}
function withHeaders(extra = {}) {
  return { credentials: "include", headers: { ...userHeaders(), ...extra } };
}

/* ----------------------------- API Doors ----------------------------- */
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
      if (id.name)  fd.append("user_name",  id.name);
      const r = await fetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT", credentials: "include", headers: userHeaders(), body: fd,
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
    if (id.name)  fd.append("user_name",  id.name);
    const r = await fetch(`/api/doors/doors/${doorId}/files`, {
      method: "POST", credentials: "include", headers: userHeaders(), body: fd,
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
    if (id.name)  fd.append("user_name",  id.name);
    const r = await fetch(`/api/doors/doors/${doorId}/photo`, {
      method: "POST", credentials: "include", headers: userHeaders(), body: fd,
    });
    return r.json();
  },

  photoUrl: (doorId) => `/api/doors/doors/${doorId}/photo`,
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

/* ----------------------------- API Doors Maps (⚠ logique: logical_name) ----------------------------- */
const MAPS = {
  uploadZip: async (file) => {
    const fd = new FormData();
    fd.append("zip", file);
    const r = await fetch(`/api/doors/maps/uploadZip`, {
      method: "POST", credentials: "include", headers: userHeaders(), body: fd,
    });
    return r.json();
  },
  // Backend renvoie { ok, plans: [...] }
  listPlans: async () => (await fetch(`/api/doors/maps/plans`, withHeaders())).json(),
  renamePlan: async (logical_name, display_name) =>
    (await fetch(`/api/doors/maps/plan/${encodeURIComponent(logical_name)}/rename`, {
      method: "PUT",
      ...withHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ display_name }),
    })).json(),
  // ⚠ ici on passe TOUJOURS logical_name (pas id)
  planFileUrl: (logical_name) => `/api/doors/maps/plan/${encodeURIComponent(logical_name)}/file`,
  // Backend renvoie { ok, items: [...] } avec x_frac / y_frac
  positions: async (logical_name, page_index = 0) =>
    (await fetch(`/api/doors/maps/positions?${new URLSearchParams({ logical_name, page_index })}`, withHeaders())).json(),
  setPosition: async (doorId, payload) =>
    (await fetch(`/api/doors/maps/positions/${encodeURIComponent(doorId)}`, {
      method: "PUT",
      ...withHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    })).json(),
};

/* ----------------------------- UI helpers ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 shadow-sm",
    ghost: "bg-white text-gray-700 border hover:bg-gray-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
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
        typeof o === "string" ? <option key={o} value={o}>{o}</option> :
        <option key={o.value} value={o.value}>{o.label}</option>
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
const STATUS = { A_FAIRE: "a_faire", EN_COURS: "en_cours_30", EN_RETARD: "en_retard", FAIT: "fait" };
const statusColor = (s) => (s === STATUS.A_FAIRE ? "green" : s === STATUS.EN_COURS ? "orange" : s === STATUS.EN_RETARD ? "red" : s === STATUS.FAIT ? "blue" : "gray");
const statusLabel = (s) => (s === STATUS.A_FAIRE ? "À faire" : s === STATUS.EN_COURS ? "En cours (<30j)" : s === STATUS.EN_RETARD ? "En retard" : s === STATUS.FAIT ? "Fait" : s || "—");
const doorStateBadge = (state) => (state === "conforme" ? <Badge color="green">Conforme</Badge> : state === "non_conforme" ? <Badge color="red">Non conforme</Badge> : <Badge>—</Badge>);

/* ----------------------------- Toast ----------------------------- */
function Toast({ text, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => onClose && onClose(), 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>
    </div>
  );
}

/* ----------------------------- Calendrier ----------------------------- */
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
  const startDow = (startOfMonth.getDay() + 6) % 7;
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
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => <div key={l} className="px-2 py-2">{l}</div>)}
      </div>

      <div className="grid grid-cols-7 border rounded-2xl overflow-hidden">
        {days.map(({ d, iso, inMonth }) => {
          const list = eventsByDate[iso] || [];
          const clickable = list.length > 0;
          return (
            <button
              key={iso}
              onClick={() => clickable && onDayClick && onDayClick({ date: iso, events: list })}
              className={`min-h-[96px] p-2 border-t border-l last:border-r text-left transition ${inMonth ? "bg-white" : "bg-gray-50"} ${clickable ? "hover:bg-blue-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className={`text-xs ${inMonth ? "text-gray-700" : "text-gray-400"}`}>{dayjs(d).format("D")}</div>
                {!!list.length && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{list.length}</span>}
              </div>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((e, i) => (
                  <div
                    key={i}
                    className={`truncate text-[11px] px-1.5 py-0.5 rounded ${
                      e.status === STATUS.EN_RETARD ? "bg-rose-50 text-rose-700" :
                      e.status === STATUS.EN_COURS ? "bg-amber-50 text-amber-700" :
                      e.status === STATUS.A_FAIRE  ? "bg-emerald-50 text-emerald-700" :
                      "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {e.door_name}
                  </div>
                ))}
                {list.length > 3 && <div className="text-[11px] text-gray-500">+{list.length - 3} de plus…</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  const [tab, setTab] = useState("controls"); // controls | calendar | settings | maps
  const [toast, setToast] = useState("");

  /* ---- Doors listing ---- */
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
  const [filesVersion, setFilesVersion] = useState(0);

  const defaultTemplate = [
    "La porte est-elle en parfait état (fermeture correcte, non voilée) ?",
    "Joint de porte en bon état (propre, non abîmé) ?",
    "Aucune modification non tracée (perçages, changement nécessitant vérification) ?",
    "Plaquette d’identification (portes ≥ 2005) visible ?",
    "Porte à double battant bien synchronisée (un battant après l’autre, fermeture OK) ?",
  ];
  const [settings, setSettings] = useState({ checklist_template: defaultTemplate, frequency: "1_an" });
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* ---- Maps state ---- */
  const [plans, setPlans] = useState([]);             // { logical_name, display_name, page_count, actions_next_30, overdue }
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [planPage, setPlanPage] = useState(0);
  const [positions, setPositions] = useState([]);

  // -------- data loaders
  async function reload() {
    setLoading(true);
    try {
      const data = await API.list({ q, status, building, floor, door_state: doorState });
      setDoors(Array.isArray(data.items) ? data.items : []);
    } finally { setLoading(false); }
  }
  async function reloadCalendar() {
    const data = await API.calendar().catch(() => ({ events: [] }));
    const events = (data?.events || []).map((e) => ({
      date: dayjs(e.date || e.next_check_date || e.due_date).format("YYYY-MM-DD"),
      door_id: e.door_id, door_name: e.door_name, status: e.status,
    }));
    setCalendar({ events });
  }
  async function loadSettings() {
    const s = await API.settingsGet().catch(() => null);
    if (s?.checklist_template?.length) setSettings((x) => ({ ...x, checklist_template: s.checklist_template }));
    if (s?.frequency) setSettings((x) => ({ ...x, frequency: s.frequency }));
  }

  useEffect(() => { reload(); reloadCalendar(); loadSettings(); }, []);
  useEffect(() => { const t = setTimeout(() => { reload(); }, 350); return () => clearTimeout(t); }, [q, status, building, floor, doorState]);

  // Deep link ?door=
  useEffect(() => {
    const getDoorParam = () => { try { return new URLSearchParams(window.location.search).get("door"); } catch { return null; } };
    const setDoorParam = (id) => {
      try {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("door", id); else url.searchParams.delete("door");
        window.history.replaceState({}, "", url);
      } catch {}
    };

    const targetId = getDoorParam();
    if (targetId) {
      (async () => {
        const full = await API.get(targetId).catch(() => null);
        if (full?.door?.id) { setEditing(full.door); setDrawerOpen(true); } else { setDoorParam(null); }
      })();
    }
    const onPop = () => { const id = getDoorParam(); if (!id) { setDrawerOpen(false); setEditing(null); } };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const filtered = doors;

  /* ---- Door actions ---- */
  function openCreate() {
    setEditing({ id: null, name: "", building: "", floor: "", location: "", status: STATUS.A_FAIRE, next_check_date: null, photo_url: null, current_check: null, door_state: null });
    setDrawerOpen(true);
  }
  async function openEdit(door) {
    const full = await API.get(door.id);
    setEditing(full?.door || door);
    setDrawerOpen(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("door", door.id);
      window.history.replaceState({}, "", url);
    } catch {}
  }
  async function saveDoorBase() {
    if (!editing) return;
    const payload = { name: editing.name, building: editing.building || "", floor: editing.floor || "", location: editing.location || "" };
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
    await reload(); await reloadCalendar();
  }
  async function deleteDoor() {
    if (!editing?.id) return;
    if (!window.confirm("Supprimer définitivement cette porte ?")) return;
    await API.remove(editing.id);
    setDrawerOpen(false); setEditing(null);
    await reload(); await reloadCalendar();
  }

  const baseOptions = [
    { value: "conforme", label: "Conforme" },
    { value: "non_conforme", label: "Non conforme" },
    { value: "na", label: "N/A" },
  ];
  function allFiveAnswered(items = []) {
    const values = (items || []).slice(0, 5).map((i) => i?.value);
    return values.length === 5 && values.every((v) => v === "conforme" || v === "non_conforme" || v === "na");
  }
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
      await reload(); await reloadCalendar();
    } else {
      const full = await API.get(editing.id);
      setEditing(full?.door);
    }
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
    } finally { setUploading(false); }
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

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const cleaned = (settings.checklist_template || []).map((s) => (s || "").trim()).filter(Boolean);
      await API.settingsSet({ checklist_template: cleaned, frequency: settings.frequency });
    } finally { setSavingSettings(false); }
  }

  /* ---- MAPS loaders ---- */
  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await MAPS.listPlans().catch(() => ({ plans: [] }));
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally { setMapsLoading(false); }
  }
  async function loadPositions(plan, pageIdx = 0) {
    if (!plan) return;
    const r = await MAPS.positions(plan.logical_name, pageIdx).catch(() => ({ items: [] }));
    setPositions(Array.isArray(r?.items) ? r.items : []);
  }
  useEffect(() => { if (tab === "maps") loadPlans(); }, [tab]);
  useEffect(() => { if (selectedPlan) loadPositions(selectedPlan, planPage); }, [selectedPlan, planPage]);

  /* ---- Plans groupés par dossiers ---- */
  const groupedPlans = useMemo(() => {
    const groups = {};
    for (const p of plans) {
      const ln = p.logical_name || "";
      const folder = ln.includes("/") ? ln.split("/")[0] : "Racine";
      (groups[folder] ||= []).push(p);
    }
    return groups;
  }, [plans]);

  const [openFolders, setOpenFolders] = useState({});
  useEffect(() => {
    // ouvrir automatiquement les dossiers qui contiennent le plan sélectionné
    if (!selectedPlan) return;
    const folder = (selectedPlan.logical_name || "").split("/")[0] || "Racine";
    setOpenFolders((o) => ({ ...o, [folder]: true }));
  }, [selectedPlan]);

  const toggleFolder = (name) => setOpenFolders((o) => ({ ...o, [name]: !o[name] }));

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

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Portes coupe-feu</h1></div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>{filtersOpen ? "Masquer les filtres" : "Filtres"}</Btn>
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
              value={status} onChange={setStatus}
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
              value={doorState} onChange={setDoorState}
              options={[
                { value: "", label: "Tous états (dernier contrôle)" },
                { value: "conforme", label: "Conforme" },
                { value: "non_conforme", label: "Non conforme" },
              ]}
            />
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => { setQ(""); setStatus(""); setBuilding(""); setFloor(""); setDoorState(""); }}>
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}

      {/* Onglet Contrôles */}
      {tab === "controls" && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[12px] z-20 bg-gray-50/90 backdrop-blur supports-[backdrop-filter]:bg-gray-50/70">
                <tr className="text-left border-b">
                  <th className="px-4 py-3 font-semibold text-gray-700">Porte</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Localisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">État</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Statut</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Prochain contrôle</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-4 text-gray-500">Chargement…</td></tr>}
                {!loading && !filtered.length && <tr><td colSpan={6} className="px-4 py-4 text-gray-500">Aucune porte.</td></tr>}
                {!loading && filtered.map((d, idx) => (
                  <tr key={d.id} className={`border-b hover:bg-gray-50 ${idx % 2 ? "bg-gray-50/40" : "bg-white"}`}>
                    <td className="px-4 py-3 min-w-[260px]">
                      <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(d)}>{d.name}</button>
                    </td>
                    <td className="px-4 py-3">{(d.building || "—") + " • " + (d.floor || "—") + (d.location ? ` • ${d.location}` : "")}</td>
                    <td className="px-4 py-3">{doorStateBadge(d.door_state)}</td>
                    <td className="px-4 py-3"><Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge></td>
                    <td className="px-4 py-3 whitespace-nowrap">{d.next_check_date ? dayjs(d.next_check_date).format("DD/MM/YYYY") : "—"}</td>
                    <td className="px-4 py-3"><Btn variant="ghost" onClick={() => openEdit(d)}>Ouvrir</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* mobile simple */}
          <div className="sm:hidden divide-y">
            {loading && <div className="p-4 text-gray-500">Chargement…</div>}
            {!loading && !filtered.length && <div className="p-4 text-gray-500">Aucune porte.</div>}
            {filtered.map((d) => (
              <div key={d.id} className="p-4">
                <div className="flex items-center justify-between">
                  <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(d)}>{d.name}</button>
                  <Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {d.building || "—"} • {d.floor || "—"} {d.location ? `• ${d.location}` : ""}
                </div>
              </div>
            ))}
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

      {/* Onglet Plans (groupé par dossiers) */}
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

          {/* Dossiers */}
          <div className="space-y-3">
            {Object.keys(groupedPlans).sort().map((folder) => {
              const list = groupedPlans[folder] || [];
              const isOpen = !!openFolders[folder];
              const next30 = list.reduce((s, p) => s + Number(p.actions_next_30 || 0), 0);
              const overdue = list.reduce((s, p) => s + Number(p.overdue || 0), 0);
              const pages = list.reduce((s, p) => s + Number(p.page_count || 0), 0);

              return (
                <div key={folder} className="border rounded-2xl bg-white shadow-sm">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2"
                    onClick={() => toggleFolder(folder)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{isOpen ? "📂" : "📁"}</span>
                      <span className="font-semibold">{folder}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge color="orange">≤30j: {next30}</Badge>
                      <Badge color="red">Retard: {overdue}</Badge>
                      <Badge color="blue">Pages: {pages}</Badge>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {list.map((p) => (
                        <PlanCard
                          key={p.logical_name}
                          plan={p}
                          onOpen={(plan) => { setSelectedPlan(plan); setPlanPage(0); }}
                          onRename={async (logical, display) => { await MAPS.renamePlan(logical, display); await loadPlans(); }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!Object.keys(groupedPlans).length && (
              <div className="text-gray-500">Aucun plan importé.</div>
            )}
          </div>

          {/* Viewer */}
          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold">
                  {(selectedPlan.display_name || selectedPlan.logical_name)} — {selectedPlan.page_count || 1} page(s)
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(planPage)}
                    onChange={(v) => setPlanPage(Number(v))}
                    options={Array.from({ length: Number(selectedPlan.page_count || 1) }, (_, i) => ({
                      value: String(i), label: `Page ${i + 1}`,
                    }))}
                  />
                  <a
                    href={MAPS.planFileUrl(selectedPlan.logical_name)}
                    target="_blank" rel="noreferrer"
                    className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                  >
                    Télécharger le PDF
                  </a>
                </div>
              </div>

              <PlanViewer
                key={`${selectedPlan.logical_name}:${planPage}`}
                logicalName={selectedPlan.logical_name}
                pageIndex={planPage}
                positions={positions}
                onMovePoint={async (doorId, x_frac, y_frac) => {
                  await MAPS.setPosition(doorId, {
                    logical_name: selectedPlan.logical_name,
                    page_index: planPage,
                    x_frac, y_frac,
                  });
                  await loadPositions(selectedPlan, planPage);
                }}
                onClickPoint={(p) => openEdit({ id: p.door_id, name: p.name })}
              />
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
                  { value: "1_an",  label: "1× par an" },
                  { value: "1_mois",label: "1× par mois" },
                  { value: "2_an",  label: "2× par an (tous les 6 mois)" },
                  { value: "3_mois",label: "Tous les 3 mois" },
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

      {/* Drawer */}
      {drawerOpen && editing && (
        <Drawer title={`Porte • ${editing.name || "nouvelle"}`} onClose={() => { setDrawerOpen(false); setEditing(null); try { const url = new URL(window.location.href); url.searchParams.delete("door"); window.history.replaceState({}, "", url); } catch {} }}>
          <div className="space-y-4">
            {/* Base info */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Nom de la porte"><Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} /></Labeled>
              <Labeled label="Bâtiment"><Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} /></Labeled>
              <Labeled label="Étage / Zone"><Input value={editing.floor || ""} onChange={(v) => setEditing({ ...editing, floor: v })} /></Labeled>
              <Labeled label="Localisation (complément)"><Input value={editing.location || ""} onChange={(v) => setEditing({ ...editing, location: v })} /></Labeled>
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
                  {editing.photo_url ? <img src={editing.photo_url} alt="photo porte" className="w-full h-full object-cover" /> : <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>}
                </div>
              </div>
            )}

            {/* Checklist */}
            <div className="border rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Checklist</div>
                {!editing.current_check && <Btn onClick={ensureCurrentCheck}>Démarrer un contrôle</Btn>}
              </div>

              {!editing.current_check && <div className="text-sm text-gray-500">Lance un contrôle pour remplir les 5 points ci-dessous.</div>}

              {!!editing.current_check && (
                <div className="space-y-3">
                  {(editing.current_check.itemsView || settings.checklist_template || defaultTemplate).slice(0, 5).map((label, i) => {
                    const val = editing.current_check.items?.[i]?.value || "";
                    const comment = editing.current_check.items?.[i]?.comment || "";
                    return (
                      <div key={i} className="grid gap-2">
                        <div className="grid md:grid-cols-[1fr,220px] gap-2 items-center">
                          <div className="text-sm">{label}</div>
                          <Select value={val} onChange={(v) => saveChecklistItem(i, "value", v)}
                                  options={baseOptions} placeholder="Sélectionner…" />
                        </div>
                        <textarea
                          className="border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100"
                          value={comment}
                          onChange={(e) => saveChecklistItem(i, "comment", e.target.value)}
                          placeholder="Commentaire (optionnel)" rows={2}
                        />
                      </div>
                    );
                  })}
                  <div className="pt-2">
                    <a
                      href={API.nonConformPDF(editing.id)}
                      target="_blank" rel="noreferrer"
                      className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center"
                    >
                      Export PDF des non-conformités (SAP)
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Fichiers */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes & photos</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input type="file" className="hidden" multiple onChange={(e) => e.target.files?.length && handleUpload(Array.from(e.target.files))} />
                    Ajouter
                  </label>
                </div>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const files = e.dataTransfer?.files; if (files?.length) handleUpload(Array.from(files)); }}
                  className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition ${uploading ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"}`}
                >
                  <div className="text-sm text-gray-600">Glisser-déposer des fichiers ici, ou utiliser “Ajouter”.</div>
                </div>

                <DoorFiles doorId={editing.id} version={filesVersion} />
              </div>
            )}

            {/* QR */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="font-semibold mb-2">QR code</div>
                <a
                  href={API.qrcodesPdf(editing.id, "80,120,200")}
                  target="_blank" rel="noreferrer"
                  className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center"
                >
                  Étiquettes PDF (HALEON)
                </a>
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
    } finally { setLoading(false); }
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
                <th className="px-3 py-2">Points</th>
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
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {Number(h.counts?.conforme || 0)} / {Number(h.counts?.nc || 0)} / {Number(h.counts?.na || 0)}
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
                    ) : <span className="text-xs text-gray-500">—</span>}
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

function PlanCard({ plan, onOpen, onRename }) {
  const canvasRef = useRef(null);
  const [thumbOk, setThumbOk] = useState(true);
  const name = plan.display_name || plan.logical_name;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = MAPS.planFileUrl(plan.logical_name); // <-- logical_name, PAS id
        const pdf = await pdfjsLib.getDocument(url).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.22 });
        const c = canvasRef.current; if (!c || cancelled) return;
        c.width = viewport.width; c.height = viewport.height;
        const ctx = c.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        setThumbOk(false);
      }
    })();
    return () => { cancelled = true; };
  }, [plan.logical_name]);

  return (
    <div className="border rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center">
        {thumbOk ? <canvas ref={canvasRef} /> : <div className="text-xs text-gray-500">Aperçu indisponible</div>}
      </div>
      <div className="p-3 space-y-2">
        <div className="text-sm font-medium truncate" title={name}>{name}</div>
        <div className="flex items-center gap-2 text-xs">
          <Badge color="orange">≤30j: {Number(plan.actions_next_30 || 0)}</Badge>
          {Number(plan.overdue || 0) > 0 && <Badge color="red">Retard: {Number(plan.overdue)}</Badge>}
          <Badge color="blue">Pages: {Number(plan.page_count || 1)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="subtle" onClick={() => onOpen(plan)}>Ouvrir</Btn>
          <Btn
            variant="ghost"
            onClick={async () => {
              const n = window.prompt("Nouveau nom d’affichage :", plan.display_name || plan.logical_name);
              const clean = (n || "").trim();
              if (!clean || clean === (plan.display_name || plan.logical_name)) return;
              await onRename(plan.logical_name, clean);
            }}
          >
            Renommer
          </Btn>
        </div>
      </div>
    </div>
  );
}

function PlanViewer({ logicalName, pageIndex = 0, positions = [], onMovePoint, onClickPoint }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = MAPS.planFileUrl(logicalName);
        const pdf = await pdfjsLib.getDocument(url).promise;
        const page = await pdf.getPage(Number(pageIndex) + 1);
        const base = page.getViewport({ scale: 1 });
        const maxW = Math.min(1200, wrapRef.current?.clientWidth || base.width);
        const s = maxW / base.width;
        const viewport = page.getViewport({ scale: s });
        const c = canvasRef.current; if (!c || cancelled) return;
        c.width = viewport.width; c.height = viewport.height;
        const ctx = c.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        setPageSize({ w: viewport.width, h: viewport.height });
        setLoaded(true);
      } catch {
        setLoaded(false);
        setPageSize({ w: 0, h: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [logicalName, pageIndex]);

  // Zoom
  const zoom = (dir) => setScale((s) => Math.max(0.5, Math.min(3, s + (dir > 0 ? 0.2 : -0.2))));
  const reset = () => setScale(1);

  // Drag
  const dragInfo = useRef(null);
  function onMouseDownPoint(e, p) {
    e.stopPropagation();
    const rect = overlayRef.current.getBoundingClientRect();
    dragInfo.current = { id: p.door_id, startX: e.clientX, startY: e.clientY, baseX: p.x_frac, baseY: p.y_frac, rect };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function onMove(e) {
    const info = dragInfo.current; if (!info) return;
    const dx = (e.clientX - info.startX) / info.rect.width;
    const dy = (e.clientY - info.startY) / info.rect.height;
    const x = Math.min(1, Math.max(0, info.baseX + dx));
    const y = Math.min(1, Math.max(0, info.baseY + dy));
    const el = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (el) el.style.transform = `translate(${x * 100}%, ${y * 100}%) translate(-50%, -50%)`;
  }
  function onUp() {
    const info = dragInfo.current;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (!info) return;
    const el = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (!el) { dragInfo.current = null; return; }
    const m = el.style.transform.match(/translate\(([\d.]+)%?,\s*([\d.]+)%?\)/);
    if (m) onMovePoint?.(info.id, Number(m[1]) / 100, Number(m[2]) / 100);
    dragInfo.current = null;
  }

  const markerClass = (s) =>
    s === STATUS.EN_RETARD ? "bg-rose-600 ring-2 ring-rose-300 animate-pulse" :
    s === STATUS.EN_COURS ? "bg-amber-500 ring-2 ring-amber-300 animate-pulse" :
    s === STATUS.A_FAIRE  ? "bg-emerald-600 ring-1 ring-emerald-300" :
                            "bg-blue-600 ring-1 ring-blue-300";

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <Btn variant="ghost" onClick={() => zoom(-1)}>−</Btn>
        <Btn variant="ghost" onClick={() => zoom(+1)}>+</Btn>
        <Btn variant="ghost" onClick={reset}>1:1</Btn>
        <div className="text-xs text-gray-500">Zoom: {(scale * 100).toFixed(0)}%</div>
      </div>

      <div ref={wrapRef} className="relative w-full overflow-auto border rounded-2xl bg-gray-50" style={{ height: 520 }}>
        {pageSize.w > 0 && (
          <div className="relative inline-block" style={{ width: pageSize.w * scale, height: pageSize.h * scale }}>
            <canvas ref={canvasRef} style={{ width: pageSize.w * scale, height: pageSize.h * scale, display: loaded ? "block" : "none" }} />
            {!loaded && <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Rendu en cours…</div>}
            <div ref={overlayRef} className="absolute inset-0">
              {positions.map((p) => (
                <div key={p.door_id} data-id={p.door_id} className="absolute"
                     style={{ transform: `translate(${(p.x_frac || 0) * 100}%, ${(p.y_frac || 0) * 100}%) translate(-50%, -50%)` }}>
                  <button
                    title={p.name}
                    onMouseDown={(e) => onMouseDownPoint(e, p)}
                    onClick={(e) => { e.stopPropagation(); onClickPoint?.(p); }}
                    className={`w-4 h-4 rounded-full shadow ${markerClass(p.status)}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        {pageSize.w === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Impossible d’afficher ce PDF (format non supporté).
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-600" /> À faire (vert)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" /> ≤30j (orange)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-600 animate-pulse" /> En retard (rouge)</span>
      </div>
    </div>
  );
}
