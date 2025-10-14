// src/pages/Doors.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";

/* ----------------------------- helpers (headers + debounce) ----------------------------- */
function getIdentityHeaders() {
  const email = localStorage.getItem("fd_user_email") || "";
  const name = localStorage.getItem("fd_user_name") || "";
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name) h["X-User-Name"] = name;
  return h;
}

async function apiFetch(path, init = {}) {
  const headers = {
    ...(init.headers || {}),
    ...getIdentityHeaders(),
  };
  const r = await fetch(path, { credentials: "include", ...init, headers });
  return r;
}

function useDebouncedEffect(effect, deps, delay = 400) {
  useEffect(() => {
    const h = setTimeout(() => effect(), delay);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ----------------------------- API (Doors) ----------------------------- */
const API = {
  // Doors CRUD + listing + filters
  list: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    const r = await apiFetch(`/api/doors/doors${qs ? `?${qs}` : ""}`);
    return r.json();
  },
  get: async (id) => (await apiFetch(`/api/doors/doors/${id}`)).json(),
  create: async (payload) =>
    (
      await apiFetch(`/api/doors/doors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).json(),
  update: async (id, payload) =>
    (
      await apiFetch(`/api/doors/doors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).json(),
  remove: async (id) => (await apiFetch(`/api/doors/doors/${id}`, { method: "DELETE" })).json(),

  // Checklist (create/close) + history
  startCheck: async (doorId) =>
    (
      await apiFetch(`/api/doors/doors/${doorId}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json(),

  saveCheck: async (doorId, checkId, payload) => {
    // Le backend accepte JSON ou multipart sur la même route.
    if (payload?.files?.length) {
      const fd = new FormData();
      fd.append("items", JSON.stringify(payload.items || []));
      if (payload.close) fd.append("close", "true");
      for (const f of payload.files) fd.append("files", f);
      const r = await apiFetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT",
        body: fd,
      });
      return r.json();
    }
    return (
      await apiFetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).json();
  },

  listHistory: async (doorId) => (await apiFetch(`/api/doors/doors/${doorId}/history`)).json(),

  // Attachments (door-level)
  listFiles: async (doorId) => (await apiFetch(`/api/doors/doors/${doorId}/files`)).json(),
  uploadFile: async (doorId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch(`/api/doors/doors/${doorId}/files`, {
      method: "POST",
      body: fd,
    });
    return r.json();
  },
  deleteFile: async (fileId) =>
    (await apiFetch(`/api/doors/files/${fileId}`, { method: "DELETE" })).json(),

  // Photo vignette
  uploadPhoto: async (doorId, file) => {
    const fd = new FormData();
    fd.append("photo", file);
    const r = await apiFetch(`/api/doors/doors/${doorId}/photo`, {
      method: "POST",
      body: fd,
    });
    return r.json();
  },
  photoUrl: (doorId) => `/api/doors/doors/${doorId}/photo`,

  // QR code (PNG stream)
  qrUrl: (doorId, size = 256, force = false) =>
    `/api/doors/doors/${doorId}/qrcode?size=${size}${force ? "&force=1" : ""}`,

  // Calendar (next checks, overdue, etc.)
  calendar: async () => (await apiFetch(`/api/doors/calendar`)).json(),

  // Settings (template & frequency)
  settingsGet: async () => (await apiFetch(`/api/doors/settings`)).json(),
  settingsSet: async (payload) =>
    (
      await apiFetch(`/api/doors/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).json(),

  // PDF non-conformités (pour SAP)
  nonConformPDF: (doorId) => `/api/doors/doors/${doorId}/nonconformities.pdf`,

  // Alerts banner
  alertsGet: async () => (await apiFetch(`/api/doors/alerts`)).json(),
};

/* ----------------------------- UI helpers ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 shadow-sm",
    ghost: "bg-white text-gray-700 border hover:bg-gray-50",
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
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Textarea({ value, onChange, className = "", rows = 2, ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      rows={rows}
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

/* ----------------------------- Toast ----------------------------- */
function Toast({ text, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => onClose && onClose(), 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>
    </div>
  );
}

/* ----------------------------- Identité utilisateur (headers) ----------------------------- */
function IdentityBox({ onChange }) {
  const [email, setEmail] = useState(localStorage.getItem("fd_user_email") || "");
  const [name, setName] = useState(localStorage.getItem("fd_user_name") || "");
  useEffect(() => {
    localStorage.setItem("fd_user_email", email || "");
    localStorage.setItem("fd_user_name", name || "");
    onChange && onChange({ email, name });
  }, [email, name]); // eslint-disable-line
  return (
    <div className="rounded-xl border bg-white p-3 flex flex-wrap gap-2 items-end">
      <div className="text-sm font-medium text-gray-700 mr-2">Mon identité</div>
      <div className="grid sm:grid-cols-2 gap-2 flex-1 min-w-[260px]">
        <Input value={name} onChange={setName} placeholder="Nom (facultatif)" />
        <Input value={email} onChange={setEmail} placeholder="Email (pour 'Effectué par')" />
      </div>
      <div className="text-xs text-gray-500 sm:ml-auto">Utilisé pour signer les contrôles</div>
    </div>
  );
}

/* ----------------------------- Bandeau alertes ----------------------------- */
function AlertsBar({ data }) {
  if (!data?.ok) return null;
  const level = data.level || "ok";
  const palette =
    level === "danger"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : level === "warn"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-emerald-50 border-emerald-200 text-emerald-800";

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm flex items-center justify-between ${palette}`}>
      <div className="flex items-center gap-3">
        <span>{data.message || "Aucune alerte."}</span>
        <div className="flex items-center gap-2 text-xs">
          <Badge color="red">Retard: {data?.counts?.overdue ?? 0}</Badge>
          <Badge color="orange">&lt;30j: {data?.counts?.due_30 ?? 0}</Badge>
          <Badge color="blue">En cours: {data?.counts?.pending ?? 0}</Badge>
          <Badge color="red">Dernier NC: {data?.counts?.last_nc ?? 0}</Badge>
        </div>
      </div>
      {/* plus de bouton Rafraîchir : on recharge automatiquement */}
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
          <Btn variant="ghost" onClick={() => setMonth((m) => m.subtract(1, "month"))}>
            ← Préc.
          </Btn>
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

/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  const [tab, setTab] = useState("controls"); // controls | calendar | settings

  /* ---- alerts ---- */
  const [alerts, setAlerts] = useState(null);
  async function reloadAlerts() {
    const a = await API.alertsGet().catch(() => null);
    setAlerts(a);
  }

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
    frequency: "1_an", // 1_an, 1_mois, 2_an, 3_mois, 2_ans
  });
  const [savingSettings, setSavingSettings] = useState(false);

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
    const data = await API.calendar();
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

  // initial load
  useEffect(() => {
    reload();
    reloadCalendar();
    loadSettings();
    reloadAlerts();
  }, []);

  // auto-reload alerts every 30s
  useEffect(() => {
    const t = setInterval(() => reloadAlerts(), 30000);
    return () => clearInterval(t);
  }, []);

  // auto search (no "Rechercher" button)
  useDebouncedEffect(() => {
    reload();
  }, [q, status, building, floor, doorState]);

  const filtered = doors; // serveur filtre déjà

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
      // merge immediately in list
      setDoors((list) =>
        list.map((d) => (d.id === editing.id ? { ...d, ...payload } : d))
      );
    } else {
      const created = await API.create(payload);
      if (created?.door?.id) {
        const full = await API.get(created.door.id);
        setEditing(full?.door || created.door);
        // optimistic insert at top
        setDoors((list) => [{ ...created.door }, ...list]);
      }
    }
    // also refresh background data (alerts, calendar)
    reloadAlerts();
    reloadCalendar();
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
    await reloadAlerts();
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

  async function saveChecklistItem(idx, value, comment) {
    if (!editing?.id || !editing?.current_check) return;
    const items = [...(editing.current_check.items || [])];
    items[idx] = { ...(items[idx] || {}), index: idx, value, comment };
    const payload = { items };
    const closed = allFiveAnswered(items);
    if (closed) payload.close = true;

    const res = await API.saveCheck(editing.id, editing.current_check.id, payload);
    if (res?.door) {
      setEditing(res.door);
      if (res?.notice) setToast(res.notice);
      await reload();
      await reloadCalendar();
      await reloadAlerts();
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
    await reloadAlerts();
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
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>
          ⚙️ Paramètres
        </Btn>
      </div>
    </div>
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      {/* Identité */}
      <IdentityBox onChange={() => { /* headers mis à jour pour les prochains fetch */ }} />

      {/* Bandeau d’alerte global */}
      <AlertsBar data={alerts} />

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
          <div className="text-xs text-gray-500">La recherche se lance automatiquement.</div>
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
                    {/* vignette */}
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
                  <a
                    className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                    href={API.qrUrl(d.id, 256)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    QR
                  </a>
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
                    <td colSpan={6} className="px-4 py-4 text-gray-500">
                      Chargement…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">
                      Aucune porte.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((d, idx) => (
                    <tr
                      key={d.id}
                      className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}
                    >
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
                          <Btn variant="ghost" onClick={() => openEdit(d)}>
                            Ouvrir
                          </Btn>
                          <a
                            className="px-2 py-1 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                            href={API.qrUrl(d.id, 256)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            QR
                          </a>
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
              <div className="text-xs text-gray-500 mt-2">
                La date de prochain contrôle s’affiche <b>sans heure</b>.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={loadSettings}>
              Annuler
            </Btn>
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
          onClose={() => {
            setDrawerOpen(false);
            setEditing(null);
            // petite synchro arrière-plan
            reload();
            reloadAlerts();
          }}
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
                Prochain contrôle :{" "}
                {editing.next_check_date ? dayjs(editing.next_check_date).format("DD/MM/YYYY") : "—"}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Btn variant="ghost" onClick={saveDoorBase}>
                Enregistrer la fiche
              </Btn>
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
                      const cmt = editing.current_check.items?.[i]?.comment || "";
                      return (
                        <div key={i} className="grid md:grid-cols-[1fr,220px] gap-2 items-start">
                          <div className="text-sm">{label}</div>
                          <div className="flex flex-col gap-2">
                            <Select
                              value={val}
                              onChange={(v) => saveChecklistItem(i, v, cmt)}
                              options={baseOptions}
                              placeholder="Sélectionner…"
                            />
                            {/* commentaire dédié */}
                            <Textarea
                              rows={2}
                              placeholder="Commentaire (obligatoire conseillé si Non conforme)"
                              value={cmt}
                              onChange={(v) => saveChecklistItem(i, val, v)}
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
                  <div className="text-sm text-gray-600">Glisser-déposer des fichiers ici, ou utiliser “Ajouter”.</div>
                </div>

                <DoorFiles doorId={editing.id} />
              </div>
            )}

            {/* QR Codes */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="font-semibold mb-2">QR code</div>
                {/* Nom de la porte au-dessus des QR */}
                <div className="text-sm text-gray-700 font-medium mb-1">{editing.name || "—"}</div>
                <div className="grid grid-cols-3 gap-3 items-start">
                  {[128, 256, 512].map((s) => (
                    <div key={s} className="border rounded-xl p-2 text-center">
                      <div className="text-xs text-gray-500 mb-1">{s}px</div>
                      <img src={API.qrUrl(editing.id, s)} alt={`QR ${s}`} className="mx-auto" />
                      <div className="mt-2 flex gap-2 justify-center">
                        <a
                          href={API.qrUrl(editing.id, s)}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs"
                        >
                          Ouvrir / Imprimer
                        </a>
                        <a
                          href={API.qrUrl(editing.id, s, true)}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-xs"
                          title="Régénérer l'image avec l'URL publique actuelle"
                        >
                          Regénérer
                        </a>
                      </div>
                    </div>
                  ))}
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
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40" ref={ref}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[640px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <Btn variant="ghost" onClick={onClose}>
            Fermer
          </Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function DoorFiles({ doorId }) {
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
  useEffect(() => {
    if (doorId) load();
  }, [doorId]);

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
        {isImage ? (
          <img src={url} alt={f.original_name} className="w-full h-full object-cover" />
        ) : (
          <div className="text-4xl">📄</div>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={f.original_name}>
          {f.original_name}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{f.mime || "file"}</div>
        <div className="flex items-center gap-2 mt-2">
          <a
            href={url}
            className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition text-xs"
            download
          >
            Télécharger
          </a>
          <button
            onClick={onDelete}
            className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition text-xs"
          >
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    {h.date ? dayjs(h.date).format("DD/MM/YYYY") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge color={statusColor(h.status)}>{statusLabel(h.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {h.result === "conforme" ? (
                      <Badge color="green">Conforme</Badge>
                    ) : h.result === "non_conforme" ? (
                      <Badge color="red">Non conforme</Badge>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-gray-600">
                      {Number(h.counts?.conforme || 0)} / {Number(h.counts?.nc || 0)} /{" "}
                      {Number(h.counts?.na || 0)}
                    </div>
                    {/* snapshot items (condensé) */}
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer text-blue-700">Voir le détail</summary>
                      <ul className="list-disc ml-4 mt-1 space-y-0.5">
                        {(h.items || []).slice(0, 5).map((it, i) => (
                          <li key={i}>
                            {it.label} —{" "}
                            <span className="font-medium">
                              {it.value === "conforme"
                                ? "Conforme"
                                : it.value === "non_conforme"
                                ? "Non conforme"
                                : "N/A"}
                            </span>
                            {it.comment ? (
                              <span className="text-gray-500"> — {it.comment}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="px-3 py-2">{h.user || "—"}</td>
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
