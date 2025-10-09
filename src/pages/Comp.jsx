// src/pages/Comp.jsx
// External Contractors (Prestataires externes)
// Onglets : Vendors | Calendar | Gantt | Analytics
// - Filtres globaux repliables (bouton) visibles sur tous les onglets
// - Pré-qualification (non_fait | en_cours | reçue)
// - Gantt coloré (vert/rouge) via status_color
// - "Open vendor" fonctionne (fetch + drawer)
// - Bug ")}" supprimé
// - Download fichiers compatible avec l'API backend

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from "chart.js";
ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

/* ----------------- API ----------------- */
const API = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`/api/comp-ext/vendors${qs ? `?${qs}` : ""}`, { credentials: "include" });
    return r.json();
  },
  getVendor: async (id) => (await fetch(`/api/comp-ext/vendors/${id}`, { credentials: "include" })).json(),
  create: async (payload) =>
    (
      await fetch(`/api/comp-ext/vendors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),
  update: async (id, payload) =>
    (
      await fetch(`/api/comp-ext/vendors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    ).json(),
  remove: async (id) =>
    (await fetch(`/api/comp-ext/vendors/${id}`, { method: "DELETE", credentials: "include" })).json(),

  calendar: async () => (await fetch(`/api/comp-ext/calendar`, { credentials: "include" })).json(),
  stats: async () => (await fetch(`/api/comp-ext/stats`, { credentials: "include" })).json(),
  alerts: async () => (await fetch(`/api/comp-ext/alerts`, { credentials: "include" })).json(),

  listFiles: async (id, category) =>
    (
      await fetch(
        `/api/comp-ext/vendors/${id}/files${category ? `?category=${encodeURIComponent(category)}` : ""}`,
        { credentials: "include" }
      )
    ).json(),
  uploadFiles: async (id, files, category = "general", onProgress) => {
    // compat upload (backend attend 'file' 1 par 1)
    return new Promise(async (resolve, reject) => {
      try {
        const results = [];
        for (const f of Array.from(files || [])) {
          const fd = new FormData();
          fd.append("file", f);
          const xhr = new XMLHttpRequest();
          const p = new Promise((res, rej) => {
            xhr.open("POST", `/api/comp-ext/vendors/${id}/upload?category=${encodeURIComponent(category)}`, true);
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable && onProgress) onProgress(Math.round((100 * e.loaded) / e.total));
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { results.push(JSON.parse(xhr.responseText)); } catch {}
                res(null);
              } else rej(new Error(`HTTP ${xhr.status}`));
            };
            xhr.onerror = () => rej(new Error("network_error"));
          });
          xhr.send(fd);
          await p;
        }
        resolve(results);
      } catch (e) { reject(e); }
    });
  },
  deleteFile: async (fileId) =>
    (await fetch(`/api/comp-ext/files/${fileId}`, { method: "DELETE", credentials: "include" })).json(),
};

/* ----------------- UI helpers ----------------- */
function Tabs({ value, onChange }) {
  const T = (id, label, emoji) => (
    <button
      onClick={() => onChange(id)}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition
        ${value === id ? "bg-blue-600 text-white shadow" : "bg-white text-gray-700 border hover:bg-gray-50"}`}
    >
      <span className="mr-1">{emoji}</span>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-2 sticky top-[60px] z-20 bg-gray-50/80 backdrop-blur supports-[backdrop-filter]:bg-gray-50/60 py-2">
      {T("vendors", "Vendors", "📋")}
      {T("calendar", "Calendar", "📅")}
      {T("gantt", "Gantt", "📈")}
      {T("analytics", "Analytics", "📊")}
    </div>
  );
}
function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], placeholder, className = "", disabled }) {
  return (
    <select
      className={`border rounded px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 disabled:bg-gray-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder || "—"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
function Badge({ children, color = "gray" }) {
  const map = {
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-emerald-100 text-emerald-700",
    yellow: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    purple: "bg-violet-100 text-violet-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[color] || map.gray}`}>{children}</span>
  );
}
const statusColor = {
  offre: (s) => (s === "po_faite" ? "green" : s?.startsWith("re") ? "blue" : "yellow"),
  jsa: (s) => (s === "signe" ? "green" : s === "receptionne" ? "blue" : "yellow"),
  access: (s) => (s === "fait" ? "green" : "red"),
  prequal: (s) => (s === "reçue" || s === "recue" ? "green" : s === "en_cours" ? "yellow" : "red"),
};

// Palette (charts)
const palette = {
  emerald: "rgba(16,185,129,0.85)",
  blue: "rgba(59,130,246,0.85)",
  amber: "rgba(245,158,11,0.85)",
  rose: "rgba(244,63,94,0.85)",
  slateGrid: "rgba(148,163,184,0.25)",
};

// Chart options
const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12 } },
    tooltip: { mode: "index", intersect: false, padding: 10 },
    title: { display: false },
  },
  layout: { padding: 8 },
};
const barOptions = {
  ...baseChartOptions,
  scales: {
    x: { grid: { display: false }, ticks: { color: "#475569" } },
    y: { grid: { color: palette.slateGrid }, ticks: { color: "#475569", precision: 0 } },
  },
};

/* ----------------- Month Calendar ----------------- */
function MonthCalendar({ events = [], onDayClick }) {
  const [month, setMonth] = useState(dayjs());
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.date] ||= []).push(e);
    return map;
  }, [events]);

  const startOfMonth = month.startOf("month").toDate();
  const endOfMonth = month.endOf("month").toDate();
  const startDow = (startOfMonth.getDay() + 6) % 7; // Monday=0
  const gridStart = new Date(startOfMonth);
  gridStart.setDate(gridStart.getDate() - startDow);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ d, iso, inMonth: d >= startOfMonth && d <= endOfMonth });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-semibold">{month.format("MMMM YYYY")}</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth((m) => m.subtract(1, "month"))}>
            ← Prev
          </button>
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth(dayjs())}>
            Today
          </button>
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth((m) => m.add(1, "month"))}>
            Next →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-xs font-medium text-gray-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l) => (
          <div key={l} className="px-2 py-2">{l}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 border rounded-xl overflow-hidden">
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
                {!!list.length && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{list.length}</span>}
              </div>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((e, i) => (
                  <div key={i} className={`truncate text-[11px] px-1.5 py-0.5 rounded ${e.status_color==="green"?"bg-emerald-50 text-emerald-700":"bg-red-50 text-red-700"}`}>
                    {e.vendor_name} (V{e.vindex})
                  </div>
                ))}
                {list.length > 3 && <div className="text-[11px] text-gray-500">+{list.length - 3} more…</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------- Page ----------------- */
export default function Comp() {
  const [tab, setTab] = useState("vendors");

  // data
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters (globaux)
  const [q, setQ] = useState("");
  const [fOffer, setFOffer] = useState("");
  const [fJsa, setFJsa] = useState("");
  const [fAccess, setFAccess] = useState("");
  const [fPreQual, setFPreQual] = useState("");
  const [fPP, setFPP] = useState(""); // "", "yes", "no"
  const [fOwner, setFOwner] = useState("");
  const [fHasFiles, setFHasFiles] = useState(""); // "", "yes", "no"
  const [fVisitsMin, setFVisitsMin] = useState("");
  const [fVisitsMax, setFVisitsMax] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  // Sorting
  const [sortBy, setSortBy] = useState({ field: "name", dir: "asc" });

  // Drawer (edit/create)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // vendor object (null => create)

  // Visit modal
  const [visitModal, setVisitModal] = useState({ open: false, date: null, items: [] });

  // Planning / Analytics
  const [calendar, setCalendar] = useState({ tasks: [], events: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const offerOptions = ["en_attente", "reçue", "po_faite"];
  const jsaOptions = ["en_attente", "transmis", "receptionne", "signe"];
  const accessOptions = ["a_faire", "fait"];
  const preQualOptions = ["non_fait", "en_cours", "reçue"];

  /* ---------- loaders ---------- */
  async function reloadVendors() {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      const data = await API.list(params);
      setList(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }
  async function reloadPlanning() {
    const data = await API.calendar();
    const tasks = (data.tasks || []).map((t) => ({
      ...t,
      start: new Date(t.start),
      end: new Date(t.end),
      type: "task",
      progress: 0,
      // Couleurs Gantt (vert/rouge) depuis backend
      styles:
        t.status_color === "green"
          ? {
              barBackgroundColor: "#10b981",
              barProgressColor: "#10b981",
              barBackgroundSelectedColor: "#10b981",
            }
          : {
              barBackgroundColor: "#ef4444",
              barProgressColor: "#ef4444",
              barBackgroundSelectedColor: "#ef4444",
            },
    }));
    setCalendar({ tasks, events: data.events || [] });
  }
  async function reloadAnalytics() {
    setStats(await API.stats());
  }
  async function reloadAll() {
    await Promise.all([reloadVendors(), reloadPlanning(), reloadAnalytics()]);
    const a = await API.alerts();
    setAlerts(Array.isArray(a?.alerts) ? a.alerts : []);
  }
  useEffect(() => {
    reloadAll();
  }, []);

  /* ---------- derived: filtered + sorted ---------- */
  const filtered = useMemo(() => {
    const from = fFrom ? dayjs(fFrom) : null;
    const to = fTo ? dayjs(fTo) : null;
    const min = fVisitsMin ? Number(fVisitsMin) : null;
    const max = fVisitsMax ? Number(fVisitsMax) : null;

    let arr = [...list];
    arr = arr.filter((v) => {
      if (fOffer && v.offer_status !== fOffer) return false;
      if (fJsa && v.jsa_status !== fJsa) return false;
      if (fAccess && v.access_status !== fAccess) return false;
      if (fPreQual && v.pre_qual_status !== fPreQual) return false;
      if (fPP === "yes" && !v.pp_applicable) return false;
      if (fPP === "no" && v.pp_applicable) return false;
      if (fOwner && !(v.owner || "").toLowerCase().includes(fOwner.toLowerCase())) return false;
      if (fHasFiles === "yes" && !(v.files_count > 0)) return false;
      if (fHasFiles === "no" && v.files_count > 0) return false;

      const nVisits = v.visits?.length || 0;
      if (min !== null && nVisits < min) return false;
      if (max !== null && nVisits > max) return false;

      if (from || to) {
        const visits = v.visits || [];
        const overlaps = visits.some((vis) => {
          const s = vis.start ? dayjs(vis.start) : null;
          const e = vis.end ? dayjs(vis.end) : s;
          if (!s) return false;
          if (from && e && e.isBefore(from, "day")) return false;
          if (to && s && s.isAfter(to, "day")) return false;
          return true;
        });
        if (!overlaps) return false;
      }

      return true;
    });

    const dir = sortBy.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const f = sortBy.field;
      const av =
        f === "first_date"
          ? a.visits?.[0]?.start || ""
          : f === "owner"
          ? a.owner || ""
          : f === "files_count"
          ? a.files_count || 0
          : f === "visits"
          ? a.visits?.length || 0
          : a.name || "";
      const bv =
        f === "first_date"
          ? b.visits?.[0]?.start || ""
          : f === "owner"
          ? b.owner || ""
          : f === "files_count"
          ? b.files_count || 0
          : f === "visits"
          ? b.visits?.length || 0
          : b.name || "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    return arr;
  }, [
    list,
    fOffer,
    fJsa,
    fAccess,
    fPreQual,
    fPP,
    fOwner,
    fHasFiles,
    fVisitsMin,
    fVisitsMax,
    fFrom,
    fTo,
    sortBy,
  ]);

  // Sorting helpers
  const sortIcon = (field) => (sortBy.field !== field ? "↕" : sortBy.dir === "asc" ? "↑" : "↓");
  const setSort = (field) =>
    setSortBy((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));

  // Drawer handlers
  function openCreate() {
    setEditing({
      name: "",
      offer_status: "en_attente",
      jsa_status: "en_attente",
      pp_applicable: false,
      pp_link: "",
      access_status: "a_faire",
      pre_qual_status: "non_fait",
      sap_wo: "",
      owner: "",
      visits: [],
    });
    setDrawerOpen(true);
  }
  function openEdit(v) {
    setEditing(JSON.parse(JSON.stringify(v)));
    setDrawerOpen(true);
  }
  async function saveEditing() {
    const payload = {
      ...editing,
      visits: (editing.visits || []).map((x, i) => ({
        index: x.index || i + 1,
        start: x.start || null,
        end: x.end || x.start || null,
      })),
    };
    if (editing.id) await API.update(editing.id, payload);
    else await API.create(payload);
    setDrawerOpen(false);
    setEditing(null);
    await reloadAll();
  }
  async function deleteEditing() {
    if (!editing?.id) return;
    await API.remove(editing.id);
    setDrawerOpen(false);
    setEditing(null);
    await reloadAll();
  }

  // Visit modal openers (Calendar & Gantt)
  function openVisitModalForDay({ date, events }) {
    setVisitModal({ open: true, date, items: events || [] });
  }
  function openVisitModalForTask(task) {
    if (!task) return;
    const startISO =
      task.startISO || (task.start instanceof Date ? task.start.toISOString().slice(0, 10) : String(task.start).slice(0, 10));
    const endISO = task.endISO || (task.end instanceof Date ? task.end.toISOString().slice(0, 10) : String(task.end).slice(0, 10));
    const item = {
      date: startISO,
      vendor_id: task.vendor_id,
      vendor_name: task.vendor_name || task.name?.split("•")?.[0]?.trim() || `Vendor #${task.vendor_id}`,
      vindex: task.vindex,
      start: startISO,
      end: endISO,
    };
    setVisitModal({ open: true, date: startISO, items: [item] });
  }
  const handleGanttSelect = (task, isSelected) => {
    if (isSelected) openVisitModalForTask(task);
  };

  /* -------------- Filtres globaux -------------- */
  const FiltersPanel = (
    <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1">
          <Input value={q} onChange={setQ} placeholder="Search by name / WO…" />
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded border hover:bg-gray-50"
            onClick={() => {
              setQ("");
              reloadVendors();
            }}
          >
            Reset search
          </button>
          <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={reloadVendors}>
            Search
          </button>
          {tab === "vendors" && (
            <button className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              + New vendor
            </button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Select value={fOffer} onChange={setFOffer} options={["en_attente", "reçue", "po_faite"]} placeholder="Offer status" />
        <Select value={fJsa} onChange={setFJsa} options={["en_attente", "transmis", "receptionne", "signe"]} placeholder="JSA status" />
        <Select value={fAccess} onChange={setFAccess} options={["a_faire", "fait"]} placeholder="Access status" />
        <Select value={fPreQual} onChange={setFPreQual} options={["non_fait", "en_cours", "reçue"]} placeholder="Pre-qualification" />
        <Select value={fPP} onChange={setFPP} options={["yes", "no"]} placeholder="PP applicable?" />
        <Input value={fOwner} onChange={setFOwner} placeholder="Owner contains…" />
        <Select value={fHasFiles} onChange={setFHasFiles} options={["yes", "no"]} placeholder="Has files?" />
        <div className="grid grid-cols-2 gap-2">
          <Input value={fVisitsMin} onChange={setFVisitsMin} placeholder="#Visits min" type="number" />
          <Input value={fVisitsMax} onChange={setFVisitsMax} placeholder="#Visits max" type="number" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={fFrom} onChange={setFFrom} type="date" placeholder="From" />
          <Input value={fTo} onChange={setFTo} type="date" placeholder="To" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
          onClick={() => {
            setFOffer("");
            setFJsa("");
            setFAccess("");
            setFPreQual("");
            setFPP("");
            setFOwner("");
            setFHasFiles("");
            setFVisitsMin("");
            setFVisitsMax("");
            setFFrom("");
            setFTo("");
          }}
        >
          Clear filters
        </button>
        <div className="text-sm text-gray-500 flex items-center">
          Showing <b className="mx-1">{filtered.length}</b> of {list.length}
        </div>
      </div>
    </div>
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">External Contractors</h1>
          <p className="text-gray-500 text-sm">Vendors offers, JSA, prevention plan, pre-qualification, access, visits, SAP WO & attachments</p>
        </div>
        <Tabs value={tab} onChange={setTab} />
      </header>

      {/* Bouton filtres global */}
      <div>
        <button
          className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
          onClick={() => setShowFilters((s) => !s)}
        >
          {showFilters ? "Hide filters" : "Show filters"}
        </button>
      </div>

      {showFilters && FiltersPanel}

      {/* VENDORS */}
      {tab === "vendors" && (
        <>
          {/* Sticky header BAR au-dessus du tableau */}
          <div className="sticky top-[118px] z-20 bg-gray-50/95 backdrop-blur border rounded-2xl px-4 py-2">
            <div className="grid grid-cols-[1.2fr_.8fr_.8fr_.8fr_.7fr_.6fr_.8fr_.8fr_.6fr_.8fr] gap-2 text-sm font-medium text-gray-700">
              <span className="cursor-pointer" onClick={() => setSort("name")}>
                Name {sortIcon("name")}
              </span>
              <span>Offer</span>
              <span>JSA</span>
              <span>Access</span>
              <span>Pre-qual</span>
              <span className="cursor-pointer" onClick={() => setSort("visits")}>
                Visits {sortIcon("visits")}
              </span>
              <span className="cursor-pointer" onClick={() => setSort("first_date")}>
                First date {sortIcon("first_date")}
              </span>
              <span className="cursor-pointer" onClick={() => setSort("owner")}>
                Owner {sortIcon("owner")}
              </span>
              <span className="cursor-pointer" onClick={() => setSort("files_count")}>
                Files {sortIcon("files_count")}
              </span>
              <span>Actions</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border shadow-sm overflow-x-auto mt-2">
            <table className="w-full">
              <thead className="sr-only">
                <tr>
                  <th>Name</th>
                  <th>Offer</th>
                  <th>JSA</th>
                  <th>Access</th>
                  <th>Pre-qual</th>
                  <th>Visits</th>
                  <th>First date</th>
                  <th>Owner</th>
                  <th>Files</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-4 text-gray-500">
                      No vendors.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={10} className="p-4 text-gray-500">
                      Loading…
                    </td>
                  </tr>
                )}

                {filtered.map((v) => {
                  const first = v.visits?.[0];
                  return (
                    <tr key={v.id} className="border-t align-top hover:bg-gray-50">
                      <td className="p-3 min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <button
                            className="text-blue-700 font-medium hover:underline"
                            onClick={() => openEdit(v)}
                            title="Edit"
                          >
                            {v.name}
                          </button>
                          {v.sap_wo && <span className="text-xs text-gray-500">• WO {v.sap_wo}</span>}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge color={statusColor.offre(v.offer_status)}>{v.offer_status}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge color={statusColor.jsa(v.jsa_status)}>{v.jsa_status}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge color={statusColor.access(v.access_status)}>{v.access_status}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge color={statusColor.prequal(v.pre_qual_status)}>{v.pre_qual_status}</Badge>
                      </td>
                      <td className="p-3">{v.visits?.length || 0}</td>
                      <td className="p-3">{first?.start ? dayjs(first.start).format("DD/MM/YYYY") : "—"}</td>
                      <td className="p-3">{v.owner || "—"}</td>
                      <td className="p-3">
                        {v.files_count ? (
                          <button
                            className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-xs"
                            onClick={() => openEdit(v)}
                          >
                            {v.files_count} file{v.files_count > 1 ? "s" : ""}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">0</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button
                            className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600"
                            onClick={() => openEdit(v)}
                          >
                            Edit
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                            onClick={async () => {
                              await API.remove(v.id);
                              await reloadAll();
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cartes mobile */}
          <div className="md:hidden grid grid-cols-1 gap-4">
            {filtered.map((v) => (
              <div key={v.id} className="bg-white rounded-2xl border shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-base font-semibold">{v.name}</div>
                    <div className="text-xs text-gray-500">Owner: {v.owner || "—"}</div>
                  </div>
                  <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => openEdit(v)}>
                    Edit
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    Offer: <Badge color={statusColor.offre(v.offer_status)}>{v.offer_status}</Badge>
                  </div>
                  <div>
                    JSA: <Badge color={statusColor.jsa(v.jsa_status)}>{v.jsa_status}</Badge>
                  </div>
                  <div>
                    Access: <Badge color={statusColor.access(v.access_status)}>{v.access_status}</Badge>
                  </div>
                  <div>
                    Pre-qual: <Badge color={statusColor.prequal(v.pre_qual_status)}>{v.pre_qual_status}</Badge>
                  </div>
                  <div>Visits: {v.visits?.length || 0}</div>
                  <div>First: {v.visits?.[0]?.start ? dayjs(v.visits[0].start).format("DD/MM/YYYY") : "—"}</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600" onClick={() => openEdit(v)}>
                    Edit
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                    onClick={async () => {
                      await API.remove(v.id);
                      await reloadAll();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Drawer d'édition / création */}
          {drawerOpen && (
            <Drawer
              onClose={() => {
                setDrawerOpen(false);
                setEditing(null);
              }}
            >
              <Editor
                value={editing}
                onChange={setEditing}
                offerOptions={offerOptions}
                jsaOptions={jsaOptions}
                accessOptions={accessOptions}
                preQualOptions={preQualOptions}
                onSave={saveEditing}
                onDelete={editing?.id ? deleteEditing : null}
              />
            </Drawer>
          )}
        </>
      )}

      {/* CALENDAR (plus de Gantt ici) */}
      {tab === "calendar" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Calendar (Month view)">
            <MonthCalendar events={calendar.events} onDayClick={openVisitModalForDay} />
          </Card>
        </div>
      )}

      {/* GANTT (couleurs actives) */}
      {tab === "gantt" && (
        <div className="grid grid-cols-1 gap-6">
          <Card
            title="Gantt"
            actions={
              <select
                className="border rounded px-2 py-1 text-sm"
                value={Object.keys(ViewMode).find((k) => ViewMode[k] === viewMode) || "Month"}
                onChange={(e) =>
                  setViewMode({ Week: ViewMode.Week, Month: ViewMode.Month, Year: ViewMode.Year }[e.target.value] || ViewMode.Month)
                }
              >
                <option value="Week">Week</option>
                <option value="Month">Month</option>
                <option value="Year">Year</option>
              </select>
            }
          >
            <div className="h-[520px] overflow-x-auto">
              {calendar?.tasks?.length ? (
                <Gantt tasks={calendar.tasks} viewMode={viewMode} onSelect={handleGanttSelect} />
              ) : (
                <div className="text-sm text-gray-500">No planned visits.</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ANALYTICS */}
      {tab === "analytics" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Offers">
            <div className="h-[380px]">
              <Doughnut
                data={donutData(stats?.counts?.offer || { en_attente: 0, recue: 0, po_faite: 0 }, [
                  palette.amber,
                  palette.blue,
                  palette.emerald,
                ])}
                options={baseChartOptions}
              />
            </div>
          </Card>
          <Card title="JSA">
            <div className="h-[380px]">
              <Doughnut
                data={donutData(stats?.counts?.jsa || { en_attente: 0, transmis: 0, receptionne: 0, signe: 0 }, [
                  palette.amber,
                  palette.blue,
                  palette.emerald,
                ])}
                options={baseChartOptions}
              />
            </div>
          </Card>
          <Card title="Access">
            <div className="h-[380px]">
              <Bar data={barData(stats?.counts?.access || { a_faire: 0, fait: 0 }, ["#f43f5e", "#10b981"])} options={barOptions} />
            </div>
          </Card>
        </div>
      )}

      {/* Visit Modal (calendar & gantt) */}
      {visitModal.open && (
        <Modal
          onClose={() => setVisitModal({ open: false, date: null, items: [] })}
          title={`Visits • ${dayjs(visitModal.date).format("DD/MM/YYYY")}`}
        >
          <div className="space-y-3">
            {visitModal.items.map((it, i) => (
              <VisitItem
                key={`${it.vendor_id}-${it.vindex}-${i}`}
                item={it}
                onOpenVendor={async () => {
                  let v = list.find((x) => x.id === it.vendor_id);
                  if (!v) {
                    const fetched = await API.getVendor(it.vendor_id);
                    v = fetched?.id ? fetched : null;
                  }
                  if (!v) return;
                  setVisitModal({ open: false, date: null, items: [] });
                  openEdit(v);
                }}
              />
            ))}
            {(!visitModal.items || visitModal.items.length === 0) && (
              <div className="text-sm text-gray-500">No visit details.</div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------- Small components ---------- */
function Card({ title, actions, children }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}
function Drawer({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Edit vendor</h3>
          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-2xl bg-white rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function VisitItem({ item, onOpenVendor }) {
  const vendorLabel = item.vendor_name || `Vendor #${item.vendor_id || "?"}`;
  const idxLabel = typeof item.vindex === "number" ? `Visit ${item.vindex}` : "Visit";
  return (
    <div className="border rounded-xl p-3 flex items-center justify-between">
      <div>
        <div className="font-medium">
          {vendorLabel} • {idxLabel}
        </div>
        <div className="text-sm text-gray-600">
          {dayjs(item.start).format("DD/MM/YYYY")} → {dayjs(item.end).format("DD/MM/YYYY")}
        </div>
      </div>
      <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={onOpenVendor}>
        Open vendor
      </button>
    </div>
  );
}

/* ---------- Editor ---------- */
function Editor({ value, onChange, onSave, onDelete, offerOptions, jsaOptions, accessOptions, preQualOptions }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });

  const [visitsCount, setVisitsCount] = useState(v?.visits?.length || v?.visits_slots || 1);
  useEffect(() => {
    setVisitsCount(v?.visits?.length || v?.visits_slots || 1);
  }, [v?.id]);

  useEffect(() => {
    const base = v?.visits || [];
    const arr = Array.from({ length: Math.max(1, Number(visitsCount) || 1) }).map((_, i) => ({
      index: i + 1,
      start: base[i]?.start || "",
      end: base[i]?.end || base[i]?.start || "",
    }));
    set({ visits: arr, visits_slots: visitsCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitsCount]);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input value={v.name || ""} onChange={(x) => set({ name: x })} placeholder="Vendor name" />
        <Input value={v.owner || ""} onChange={(x) => set({ owner: x })} placeholder="Owner" />

        <Select value={v.offer_status || "en_attente"} onChange={(x) => set({ offer_status: x })} options={offerOptions} placeholder="Offer status" />
        <Select value={v.jsa_status || "en_attente"} onChange={(x) => set({ jsa_status: x })} options={jsaOptions} placeholder="JSA status" />
        <Select value={v.access_status || "a_faire"} onChange={(x) => set({ access_status: x })} options={accessOptions} placeholder="Access status" />
        <Select value={v.pre_qual_status || "non_fait"} onChange={(x) => set({ pre_qual_status: x })} options={preQualOptions} placeholder="Pre-qualification" />

        <Input value={v.sap_wo || ""} onChange={(x) => set({ sap_wo: x })} placeholder="Upcoming WO" />

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!v.pp_applicable} onChange={(e) => set({ pp_applicable: e.target.checked })} />
          <span className="text-sm">Prevention plan applicable</span>
        </label>
        {v.pp_applicable && (
          <Input value={v.pp_link || ""} onChange={(x) => set({ pp_link: x })} placeholder="SafePermit link" />
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!v.work_permit_required}
            onChange={(e) => set({ work_permit_required: e.target.checked })}
          />
          <span className="text-sm">Permis de travail requis</span>
        </label>
        {v.work_permit_required && (
          <Input
            value={v.work_permit_link || ""}
            onChange={(x) => set({ work_permit_link: x })}
            placeholder="SafePermit link (Permis de travail)"
          />
        )}
      </div>

      <div className="border rounded-xl p-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-sm text-gray-600">Visits</div>
          <input
            type="number"
            min={1}
            className="border rounded px-2 py-1
