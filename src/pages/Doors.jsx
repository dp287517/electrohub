// src/pages/Doors.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";

/* ----------------------------- API (Doors) ----------------------------- */
const API = {
  // Doors CRUD + listing + filters
  list: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    const r = await fetch(`/api/doors/doors${qs ? `?${qs}` : ""}`, { credentials: "include" });
    return r.json();
  },
  get: async (id) => (await fetch(`/api/doors/doors/${id}`, { credentials: "include" })).json(),
  create: async (payload) =>
    (
      await fetch(`/api/doors/doors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),
  update: async (id, payload) =>
    (
      await fetch(`/api/doors/doors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),
  remove: async (id) => (await fetch(`/api/doors/doors/${id}`, { method: "DELETE", credentials: "include" })).json(),

  // Checklist (create/close) + history
  startCheck: async (doorId) =>
    (
      await fetch(`/api/doors/doors/${doorId}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      })
    ).json(),
  saveCheck: async (doorId, checkId, payload) =>
    (
      await fetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),
  listHistory: async (doorId) =>
    (await fetch(`/api/doors/doors/${doorId}/history`, { credentials: "include" })).json(),

  // Attachments (photo + drag & drop)
  listFiles: async (doorId) =>
    (await fetch(`/api/doors/doors/${doorId}/files`, { credentials: "include" })).json(),
  uploadFile: async (doorId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/doors/doors/${doorId}/files`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    return r.json();
  },
  deleteFile: async (fileId) =>
    (await fetch(`/api/doors/files/${fileId}`, { method: "DELETE", credentials: "include" })).json(),

  // QR code (PNG stream)
  qrUrl: (doorId, size = 256) => `/api/doors/doors/${doorId}/qrcode?size=${size}`,

  // Calendar (next checks, overdue, etc.)
  calendar: async () => (await fetch(`/api/doors/calendar`, { credentials: "include" })).json(),

  // Settings (template & frequency)
  settingsGet: async () => (await fetch(`/api/doors/settings`, { credentials: "include" })).json(),
  settingsSet: async (payload) =>
    (
      await fetch(`/api/doors/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),

  // PDF non-conformités (pour SAP)
  nonConformPDF: (doorId) => `/api/doors/doors/${doorId}/nonconformities.pdf`,
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

/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  const [tab, setTab] = useState("controls"); // controls | calendar | settings

  /* ---- listing + filters ---- */
  const [doors, setDoors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(""); // a_faire | en_cours_30 | en_retard | fait
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");

  /* ---- drawer (edit / inspect) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // door object with details

  /* ---- calendar ---- */
  const [calendar, setCalendar] = useState({ events: [] });

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
      const data = await API.list({ q, status, building, floor });
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
    if (s?.checklist_template?.length) setSettings((x) => ({ ...x, checklist_template: s.checklist_template }));
    if (s?.frequency) setSettings((x) => ({ ...x, frequency: s.frequency }));
  }

  useEffect(() => {
    reload();
    reloadCalendar();
    loadSettings();
  }, []);

  const filtered = doors; // (server already filters; keep placeholder if client-side filters needed)

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
      files: [],
      current_check: null,
      history: [],
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
    if (editing.id) await API.update(editing.id, payload);
    else {
      const created = await API.create(payload);
      if (created?.door?.id) {
        const full = await API.get(created.door.id);
        setEditing(full?.door || created.door);
      }
    }
    await reload();
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

  function allFiveConforme(items = []) {
    const values = (items || []).map((i) => i.value);
    return values.length >= 5 && values.every((v) => v === "conforme");
  }

  async function saveChecklistItem(idx, value) {
    if (!editing?.id || !editing?.current_check) return;
    const items = [...(editing.current_check.items || [])];
    items[idx] = { ...(items[idx] || {}), index: idx, value };
    const payload = { items };
    const closed =
      allFiveConforme(items) && // 5/5 conformes
      items.length >= 5;

    if (closed) payload.close = true; // côté serveur : passe statut → fait + planifie prochaine date

    const res = await API.saveCheck(editing.id, editing.current_check.id, payload);
    if (res?.door) {
      setEditing(res.door);
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
    } finally {
      setUploading(false);
    }
  }

  /* ------------------ settings save ------------------ */
  async function saveSettings() {
    setSavingSettings(true);
    try {
      const cleaned = (settings.checklist_template || []).map((s) => (s || "").trim()).filter(Boolean);
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
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Portes coupe-feu</h1>
          <p className="text-gray-500 text-sm">
            Contrôles annuels, QR codes, historique, pièces jointes & alertes.
          </p>
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
          <div className="grid md:grid-cols-4 gap-3">
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / lieu…)" />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "Tous statuts" },
                { value: STATUS.A_FAIRE, label: "À faire (vert)" },
                { value: STATUS.EN_COURS, label: "En cours <30j (orange)" },
                { value: STATUS.EN_RETARD, label: "En retard (rouge)" },
                { value: STATUS.FAIT, label: "Fait" },
              ]}
            />
            <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
            <Input value={floor} onChange={setFloor} placeholder="Étage / Zone" />
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => { setQ(""); setStatus(""); setBuilding(""); setFloor(""); reload(); }}>
              Réinitialiser
            </Btn>
            <Btn onClick={reload}>Rechercher</Btn>
          </div>
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
                  <div>
                    <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(d)}>
                      {d.name}
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {d.building || "—"} • {d.floor || "—"} {d.location ? `• ${d.location}` : ""}
                    </div>
                  </div>
                  <Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge>
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  Prochain contrôle:{" "}
                  {d.next_check_date ? dayjs(d.next_check_date).format("DD/MM/YYYY") : "—"}
                </div>
                <div className="mt-3 flex gap-2">
                  <Btn variant="ghost" onClick={() => openEdit(d)}>
                    Ouvrir
                  </Btn>
                  <a className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                     href={API.qrUrl(d.id, 256)} target="_blank" rel="noreferrer">
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
                  <th className="px-4 py-3 font-semibold text-gray-700">Nom</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Localisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Statut</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Prochain contrôle</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-gray-500">Chargement…</td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-gray-500">Aucune porte.</td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((d, idx) => (
                    <tr key={d.id} className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}>
                      <td className="px-4 py-3 min-w-[220px]">
                        <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(d)}>
                          {d.name}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {(d.building || "—") + " • " + (d.floor || "—") + (d.location ? ` • ${d.location}` : "")}
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
              // ouvre la première porte de la journée
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
                Les inspections déjà effectuées restent figées. Modifie ici les intitulés pour les **prochaines** checklists.
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
                La date de prochain contrôle s’affiche **sans heure**.
              </div>
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
        <Drawer title={`Porte • ${editing.name || "nouvelle"}`} onClose={() => { setDrawerOpen(false); setEditing(null); }}>
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

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Statut</span>
                <Badge color={statusColor(editing.status)}>{statusLabel(editing.status)}</Badge>
              </div>
              <div className="text-sm text-gray-600">
                Prochain contrôle :{" "}
                {editing.next_check_date ? dayjs(editing.next_check_date).format("DD/MM/YYYY") : "—"}
              </div>
            </div>

            <div className="flex gap-2">
              <Btn variant="ghost" onClick={saveDoorBase}>Enregistrer la fiche</Btn>
              {editing?.id && (
                <Btn variant="danger" onClick={deleteDoor}>Supprimer</Btn>
              )}
            </div>

            {/* Checklist */}
            <div className="border rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Checklist</div>
                {!editing.current_check && (
                  <Btn onClick={ensureCurrentCheck}>Démarrer un contrôle</Btn>
                )}
              </div>

              {!editing.current_check && (
                <div className="text-sm text-gray-500">
                  Lance un contrôle pour remplir les 5 points ci-dessous.
                </div>
              )}

              {!!editing.current_check && (
                <div className="space-y-2">
                  {(editing.current_check.itemsView || settings.checklist_template || defaultTemplate).slice(0, 5).map((label, i) => {
                    const val = editing.current_check.items?.[i]?.value || "";
                    return (
                      <div key={i} className="grid md:grid-cols-[1fr,220px] gap-2 items-center">
                        <div className="text-sm">{label}</div>
                        <Select
                          value={val}
                          onChange={(v) => saveChecklistItem(i, v)}
                          options={baseOptions}
                          placeholder="Sélectionner…"
                        />
                      </div>
                    );
                  })}

                  {/* PDF non-conformités */}
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

                <DoorFiles doorId={editing.id} />
              </div>
            )}

            {/* QR Codes */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="font-semibold mb-2">QR code</div>
                <div className="grid grid-cols-3 gap-3 items-start">
                  {[128, 256, 512].map((s) => (
                    <div key={s} className="border rounded-xl p-2 text-center">
                      <div className="text-xs text-gray-500 mb-1">{s}px</div>
                      <img
                        src={API.qrUrl(editing.id, s)}
                        alt={`QR ${s}`}
                        className="mx-auto"
                      />
                      <a
                        href={API.qrUrl(editing.id, s)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs"
                      >
                        Ouvrir / Imprimer
                      </a>
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
  useEffect(() => { if (doorId) load(); }, [doorId]);

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
                <th className="px-3 py-2">Effectué par</th>
                <th className="px-3 py-2">Commentaires</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {h.date ? dayjs(h.date).format("DD/MM/YYYY") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge color={statusColor(h.status)}>{statusLabel(h.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">{h.user || "—"}</td>
                  <td className="px-3 py-2">{h.comment || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
