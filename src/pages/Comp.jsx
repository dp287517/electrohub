// src/pages/Comp.jsx
// External Contractors (Prestataires externes)

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

// ----------------- API -----------------
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
    const fd = new FormData();
    (files || []).forEach((f) => fd.append("files", f));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `/api/comp-ext/vendors/${id}/upload?category=${encodeURIComponent(category)}`,
        true
      );
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((100 * e.loaded) / e.total));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve({});
          }
        } else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("network_error"));
      xhr.send(fd);
    });
  },
  deleteFile: async (fileId) =>
    (await fetch(`/api/comp-ext/files/${fileId}`, { method: "DELETE", credentials: "include" })).json(),

  ask: async (question) =>
    (
      await fetch(`/api/comp-ext/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question }),
      })
    ).json(),
};

// ----------------- UI helpers -----------------
function Tabs({ value, onChange }) {
  // Mesure dynamique de la hauteur de la barre d'onglets pour caler toutes les stickies
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--tabs-h", `${el.offsetHeight}px`);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

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
    <div
      ref={ref}
      className="flex flex-wrap gap-2 sticky top-[60px] z-30 bg-gray-50/80 backdrop-blur supports-[backdrop-filter]:bg-gray-50/60 py-2"
    >
      {T("vendors", "Vendors", "📋")}
      {T("calendar", "Calendar", "📅")}
      {T("gantt", "Gantt", "📈")}
      {T("analytics", "Analytics", "📊")}
      {T("ai", "IA", "🤖")}
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
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[color] || map.gray}`}>
      {children}
    </span>
  );
}
const statusColor = {
  offre: (s) => (s === "po_faite" ? "green" : s?.startsWith("re") ? "blue" : "yellow"),
  msra: (s) => (s === "signe" ? "green" : s === "receptionne" ? "blue" : "yellow"),
  access: (s) => (s === "fait" ? "green" : "red"),
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

// ----------------- Filtres globaux (toggle) -----------------
function GlobalFilters({ state, setters, onSearch, onClear, visible }) {
  const {
    q, fOffer, fMsra, fPrequal, fAccess, fPP, fOwner, fHasFiles, fVisitsMin, fVisitsMax, fFrom, fTo,
  } = state;
  const {
    setQ, setFOffer, setFMsra, setFPrequal, setFAccess, setFPP, setFOwner, setFHasFiles, setFVisitsMin, setFVisitsMax, setFFrom, setFTo,
  } = setters;

  if (!visible) return null;
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1">
          <Input value={q} onChange={setQ} placeholder="Search by name / WO…" />
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClear}>Clear</button>
          <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={onSearch}>Search</button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Select value={fOffer} onChange={setFOffer} options={["en_attente", "reçue", "po_faite"]} placeholder="Offer status" />
        <Select value={fMsra} onChange={setFMsra} options={["en_attente", "transmis", "receptionne", "signe"]} placeholder="MSRA status" />
        <Select value={fPrequal} onChange={setFPrequal} options={["non_fait", "en_cours", "reçue"]} placeholder="Pre-qual status" />
        <Select value={fAccess} onChange={setFAccess} options={["a_faire", "fait"]} placeholder="Access status" />
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
    </div>
  );
}

// ----------------- Month Calendar -----------------
function MonthCalendar({ events = [], onDayClick }) {
  const [month, setMonth] = useState(dayjs());
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.date] ||= []).push(e);
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
    const iso = d.toISOString().slice(0, 10);
    days.push({ d, iso, inMonth: d >= startOfMonth && d <= endOfMonth });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-semibold">{month.format("MMMM YYYY")}</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth((m) => m.subtract(1, "month"))}>← Prev</button>
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth(dayjs())}>Today</button>
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth((m) => m.add(1, "month"))}>Next →</button>
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

// ----------------- Page -----------------
export default function Comp() {
  const [tab, setTab] = useState("vendors");

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters (globaux)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fOffer, setFOffer] = useState("");
  const [fMsra, setFMsra] = useState("");
  const [fPrequal, setFPrequal] = useState("");
  const [fAccess, setFAccess] = useState("");
  const [fPP, setFPP] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fHasFiles, setFHasFiles] = useState("");
  const [fVisitsMin, setFVisitsMin] = useState("");
  const [fVisitsMax, setFVisitsMax] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  // Sorting
  const [sortBy, setSortBy] = useState({ field: "name", dir: "asc" });

  // Drawer (edit/create)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // Visit modal
  const [visitModal, setVisitModal] = useState({ open: false, date: null, items: [] });

  // Planning / Analytics / Alerts
  const [calendar, setCalendar] = useState({ tasks: [], events: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // IA
  const [aiQ, setAiQ] = useState("");
  const [aiA, setAiA] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Offset sticky : header (60px) + hauteur onglets (--tabs-h) + marge
  const stickyTop = "calc(60px + var(--tabs-h, 44px) + 8px)";

  const offerOptions = ["en_attente", "reçue", "po_faite"];
  const msraOptions = ["en_attente", "transmis", "receptionne", "signe"];
  const prequalOptions = ["non_fait", "en_cours", "reçue"];
  const accessOptions = ["a_faire", "fait"];

  // Loaders
  async function reloadVendors() {
    setLoading(true);
    try {
      const data = await API.list(q ? { q } : {});
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
      styles:
        t.status_color === "green"
          ? { barBackgroundColor: "#10b981", barProgressColor: "#10b981", barBackgroundSelectedColor: "#10b981" }
          : { barBackgroundColor: "#ef4444", barProgressColor: "#ef4444", barBackgroundSelectedColor: "#ef4444" },
    }));
    setCalendar({ tasks, events: data.events || [] });
  }
  async function reloadAnalytics() {
    setStats(await API.stats());
  }
  async function reloadAll() {
    const [_, __, ___, a] = await Promise.all([reloadVendors(), reloadPlanning(), reloadAnalytics(), API.alerts()]);
    setAlerts(Array.isArray(a?.alerts) ? a.alerts : []);
  }
  useEffect(() => { reloadAll(); }, []);

  // Derived filtered + sorted list
  const filtered = useMemo(() => {
    const from = fFrom ? dayjs(fFrom) : null;
    const to = fTo ? dayjs(fTo) : null;
    const min = fVisitsMin ? Number(fVisitsMin) : null;
    const max = fVisitsMax ? Number(fVisitsMax) : null;

    let arr = [...list];
    arr = arr.filter(v => {
      if (fOffer && v.offer_status !== fOffer) return false;
      if (fMsra && (v.msra_status || v.jsa_status) !== fMsra) return false;
      if (fPrequal && (v.prequal_status || "") !== fPrequal) return false;
      if (fAccess && v.access_status !== fAccess) return false;
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
        const overlaps = visits.some(vis => {
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
    arr.sort((a,b) => {
      const f = sortBy.field;
      const av = f==="first_date" ? (a.visits?.[0]?.start || "") :
                 f==="owner" ? (a.owner||"") :
                 f==="files_count" ? (a.files_count||0) :
                 f==="visits" ? (a.visits?.length||0) :
                 f==="offer_status" ? (a.offer_status || "") :
                 f==="msra_status" ? (a.msra_status || a.jsa_status || "") :
                 f==="prequal_status" ? (a.prequal_status || "") :
                 (a.name||"");
      const bv = f==="first_date" ? (b.visits?.[0]?.start || "") :
                 f==="owner" ? (b.owner||"") :
                 f==="files_count" ? (b.files_count||0) :
                 f==="visits" ? (b.visits?.length||0) :
                 f==="offer_status" ? (b.offer_status || "") :
                 f==="msra_status" ? (b.msra_status || b.jsa_status || "") :
                 f==="prequal_status" ? (b.prequal_status || "") :
                 (b.name||"");
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    return arr;
  }, [list, fOffer, fMsra, fPrequal, fAccess, fPP, fOwner, fHasFiles, fVisitsMin, fVisitsMax, fFrom, fTo, sortBy]);

  // Sorting helpers
  const setSort = (field) =>
    setSortBy((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));

  // Drawer handlers
  function openCreate() {
    setEditing({
      name: "",
      offer_status: "en_attente",
      msra_status: "en_attente",
      prequal_status: "non_fait",
      pp_applicable: false,
      pp_link: "",
      work_permit_required: false,
      work_permit_link: "",
      access_status: "a_faire",
      sap_wo: "",
      owner: "",
      visits: [],
      visits_slots: 1,
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

  // Visit modal
  function openVisitModalForDay({ date, events }) {
    setVisitModal({ open: true, date, items: events || [] });
  }
  function openVisitModalForTask(task) {
    if (!task) return;
    const startISO = task.startISO || (task.start instanceof Date ? task.start.toISOString().slice(0,10) : String(task.start).slice(0,10));
    const endISO   = task.endISO   || (task.end   instanceof Date ? task.end.toISOString().slice(0,10)   : String(task.end).slice(0,10));
    const item = {
      date: startISO,
      vendor_id: task.vendor_id,
      vendor_name: task.name?.split("•")?.[0]?.trim() || task.vendor_name || `Vendor #${task.vendor_id}`,
      vindex: task.vindex,
      start: startISO,
      end: endISO,
    };
    setVisitModal({ open: true, date: startISO, items: [item] });
  }
  const handleGanttSelect = (task, isSelected) => { if (isSelected) openVisitModalForTask(task); };

  // Filtre actions
  const filtersState = { q, fOffer, fMsra, fPrequal, fAccess, fPP, fOwner, fHasFiles, fVisitsMin, fVisitsMax, fFrom, fTo };
  const filtersSetters = { setQ, setFOffer, setFMsra, setFPrequal, setFAccess, setFPP, setFOwner, setFHasFiles, setFVisitsMin, setFVisitsMax, setFFrom, setFTo };
  const onSearch = () => reloadVendors();
  const onClear = () => {
    setQ(""); setFOffer(""); setFMsra(""); setFPrequal(""); setFAccess(""); setFPP(""); setFOwner("");
    setFHasFiles(""); setFVisitsMin(""); setFVisitsMax(""); setFFrom(""); setFTo("");
    reloadVendors();
  };

  // ---------- RENDER ----------
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">External Contractors</h1>
          <p className="text-gray-500 text-sm">
            Vendors offers, MSRA, pre-qualification, prevention plan, access, visits, SAP WO & attachments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => setFiltersOpen((v) => !v)}>
            {filtersOpen ? "Hide filters" : "Filters"}
          </button>
          <button className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
            + New vendor
          </button>
        </div>
      </header>

      <Tabs value={tab} onChange={setTab} />

      {/* FILTRES GLOBAUX */}
      <GlobalFilters
        state={filtersState}
        setters={filtersSetters}
        visible={filtersOpen}
        onSearch={onSearch}
        onClear={onClear}
      />

      {/* VENDORS */}
      {tab === "vendors" && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-x-auto relative">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <colgroup>
              <col style={{ width: "15.2%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "8.9%" }} />
              <col style={{ width: "7.6%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "7.6%" }} />
              <col style={{ width: "9.7%" }} />
            </colgroup>

            {/* THEAD sticky (plus de header miroir) */}
            <thead
              style={{ position: "sticky", top: "calc(60px + var(--tabs-h, 44px) + 8px)", zIndex: 50 }}
              className="bg-gray-50/95 backdrop-blur"
            >
              <tr>
                {[
                  { k:"name", label:"Name" },
                  { k:"offer_status", label:"Offer" },
                  { k:"msra_status", label:"MSRA" },
                  { k:"prequal_status", label:"Pre-qual" },
                  { k:"pp", label:"PP", noSort:true },
                  { k:"visits", label:"Visits" },
                  { k:"first_date", label:"First date" },
                  { k:"owner", label:"Owner" },
                  { k:"files_count", label:"Files" },
                  { k:"actions", label:"Actions", noSort:true },
                ].map(col => (
                  <th
                    key={col.k}
                    className="text-left font-medium text-sm text-gray-700 px-4 py-2 border-b"
                  >
                    {!col.noSort ? (
                      <button
                        onClick={() => setSort(col.k)}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <span>{col.label}</span>
                        <span className="text-xs">
                          {sortBy.field !== col.k ? "↕" : (sortBy.dir === "asc" ? "↑" : "↓")}
                        </span>
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="text-sm align-top">
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="p-4 text-gray-500">No vendors.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={10} className="p-4 text-gray-500">Loading…</td></tr>
              )}

              {filtered.map(v => {
                const first = v.visits?.[0];
                const preq = v.prequal_status || "non_fait";
                return (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 border-t">
                      <div className="flex items-center gap-2 min-w-[220px]">
                        <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(v)} title="Edit">
                          {v.name}
                        </button>
                        {v.sap_wo && <span className="text-xs text-gray-500">• WO {v.sap_wo}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 border-t">
                      <Badge color={statusColor.offre(v.offer_status)}>{v.offer_status}</Badge>
                    </td>
                    <td className="px-4 py-3 border-t">
                      <Badge color={statusColor.msra(v.msra_status || v.jsa_status)}>{v.msra_status || v.jsa_status}</Badge>
                    </td>
                    <td className="px-4 py-3 border-t">
                      <Badge color={preq==="reçue"||preq==="recue"?"blue":preq==="en_cours"?"yellow":"gray"}>{preq}</Badge>
                    </td>
                    <td className="px-4 py-3 border-t">
                      {v.pp_applicable ? (
                        v.pp_link ? (
                          <a className="text-emerald-700 underline" href={v.pp_link} target="_blank" rel="noreferrer">Applicable (link)</a>
                        ) : <span className="text-emerald-700">Applicable</span>
                      ) : <span className="text-gray-500">N/A</span>}
                    </td>
                    <td className="px-4 py-3 border-t">{v.visits?.length || 0}</td>
                    <td className="px-4 py-3 border-t">{first?.start ? dayjs(first.start).format("DD/MM/YYYY") : "—"}</td>
                    <td className="px-4 py-3 border-t">{v.owner || "—"}</td>
                    <td className="px-4 py-3 border-t">
                      {v.files_count ? (
                        <button
                          className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-xs"
                          onClick={() => openEdit(v)}
                        >
                          {v.files_count} file{v.files_count > 1 ? "s" : ""}
                        </button>
                      ) : <span className="text-gray-400 text-xs">0</span>}
                    </td>
                    <td className="px-4 py-3 border-t">
                      <div className="flex gap-2">
                        <button className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600" onClick={() => openEdit(v)}>Edit</button>
                        <button
                          className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                          onClick={async () => { await API.remove(v.id); await reloadAll(); }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CALENDAR */}
      {tab === "calendar" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Calendar (Month view)">
            <MonthCalendar events={calendar.events} onDayClick={openVisitModalForDay} />
          </Card>
        </div>
      )}

      {/* GANTT */}
      {tab === "gantt" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Gantt" actions={
            <select className="border rounded px-2 py-1 text-sm"
              value={Object.keys(ViewMode).find((k) => ViewMode[k] === viewMode) || "Month"}
              onChange={(e) => setViewMode({ Week: ViewMode.Week, Month: ViewMode.Month, Year: ViewMode.Year }[e.target.value] || ViewMode.Month)}
            >
              <option value="Week">Week</option>
              <option value="Month">Month</option>
              <option value="Year">Year</option>
            </select>
          }>
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
              <Doughnut data={donutData(stats?.counts?.offer || { en_attente:0, recue:0, po_faite:0 }, [palette.amber, palette.blue, palette.emerald])} options={baseChartOptions} />
            </div>
          </Card>
          <Card title="MSRA">
            <div className="h-[380px]">
              <Doughnut data={donutData(stats?.counts?.msra || { en_attente:0, transmis:0, receptionne:0, signe:0 }, [palette.amber, palette.blue, palette.emerald, palette.rose])} options={baseChartOptions} />
            </div>
          </Card>
          <Card title="Access">
            <div className="h-[380px]">
              <Bar data={barData(stats?.counts?.access || { a_faire:0, fait:0 }, ["#f43f5e", "#10b981"])} options={barOptions} />
            </div>
          </Card>
        </div>
      )}

      {/* IA (ancienne zone 1Q/1R conservée telle quelle) */}
      {tab === "ai" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Assistant IA">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={aiQ} onChange={setAiQ} placeholder="Pose ta question (ex: Quelles sont les prochaines visites ?)"/>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={async ()=>{
                    if(!aiQ.trim()) return;
                    setAiLoading(true); setAiA("");
                    try{
                      const r = await API.ask(aiQ.trim());
                      setAiA(r?.answer || "No answer.");
                    } finally {
                      setAiLoading(false);
                    }
                  }}
                  disabled={aiLoading}
                >
                  {aiLoading ? "Thinking…" : "Ask"}
                </button>
              </div>
              <div className="border rounded-xl p-3 min-h-[140px] bg-gray-50 whitespace-pre-wrap">
                {aiA || "—"}
              </div>
              <div className="text-xs text-gray-500">
                Astuce : “montre-moi les visites la semaine prochaine”, “qu’est-ce qu’il manque pour ces visites”, etc.
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Visit Modal */}
      {visitModal.open && (
        <Modal onClose={()=>setVisitModal({ open:false, date:null, items:[] })} title={`Visits • ${dayjs(visitModal.date).format("DD/MM/YYYY")}`}>
          <div className="space-y-3">
            {visitModal.items.map((it, i) => (
              <VisitItem
                key={`${it.vendor_id}-${it.vindex}-${i}`}
                item={it}
                onOpenVendor={async () => {
                  let v = list.find(x => x.id === it.vendor_id);
                  if (!v) {
                    const fetched = await API.getVendor(it.vendor_id);
                    v = fetched?.id ? fetched : null;
                  }
                  if (!v) return;
                  setVisitModal({ open:false, date:null, items:[] });
                  openEdit(v);
                }}
              />
            ))}
            {(!visitModal.items || visitModal.items.length===0) && (
              <div className="text-sm text-gray-500">No visit details.</div>
            )}
          </div>
        </Modal>
      )}

      {/* Drawer éditeur */}
      {drawerOpen && (
        <Drawer onClose={()=>{ setDrawerOpen(false); setEditing(null); }}>
          <Editor
            value={editing}
            onChange={setEditing}
            offerOptions={offerOptions}
            msraOptions={msraOptions}
            prequalOptions={prequalOptions}
            accessOptions={accessOptions}
            onSave={saveEditing}
            onDelete={editing?.id ? deleteEditing : null}
          />
        </Drawer>
      )}
    </section>
  );
}

// ---------- Small components ----------
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
      <div className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Edit vendor</h3>
          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>Close</button>
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
          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>Close</button>
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
        <div className="font-medium">{vendorLabel} • {idxLabel}</div>
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

function Labeled({ label, children }) {
  return (
    <label className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      {children}
    </label>
  );
}

function Editor({ value, onChange, onSave, onDelete, offerOptions, msraOptions, prequalOptions, accessOptions }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });

  const [visitsCount, setVisitsCount] = useState(v?.visits?.length || v?.visits_slots || 1);
  useEffect(() => { setVisitsCount(v?.visits?.length || v?.visits_slots || 1); }, [v?.id]);

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
        <Labeled label="Vendor name">
          <Input value={v.name || ""} onChange={(x) => set({ name: x })} placeholder="Vendor name" />
        </Labeled>
        <Labeled label="Owner">
          <Input value={v.owner || ""} onChange={(x) => set({ owner: x })} placeholder="Owner" />
        </Labeled>

        <Labeled label="Offer status">
          <Select value={v.offer_status || "en_attente"} onChange={(x) => set({ offer_status: x })} options={offerOptions} placeholder="Offer status" />
        </Labeled>
        <Labeled label="MSRA status">
          <Select value={v.msra_status || "en_attente"} onChange={(x) => set({ msra_status: x })} options={msraOptions} placeholder="MSRA status" />
        </Labeled>
        <Labeled label="Pre-qualification status">
          <Select value={v.prequal_status || "non_fait"} onChange={(x) => set({ prequal_status: x })} options={prequalOptions} placeholder="Pre-qual status" />
        </Labeled>
        <Labeled label="Access status">
          <Select value={v.access_status || "a_faire"} onChange={(x) => set({ access_status: x })} options={accessOptions} placeholder="Access status" />
        </Labeled>

        <Labeled label="Upcoming WO">
          <Input value={v.sap_wo || ""} onChange={(x) => set({ sap_wo: x })} placeholder="Upcoming WO" />
        </Labeled>

        <Labeled label="Prevention plan applicable">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!v.pp_applicable} onChange={(e)=>set({ pp_applicable: e.target.checked })} />
            <span className="text-sm">Yes</span>
          </div>
        </Labeled>
        {v.pp_applicable && (
          <Labeled label="SafePermit link (Prévention plan)">
            <Input value={v.pp_link || ""} onChange={(x)=>set({ pp_link: x })} placeholder="https://…" />
          </Labeled>
        )}

        <Labeled label="Permis de travail requis">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!v.work_permit_required} onChange={(e)=>set({ work_permit_required: e.target.checked })} />
            <span className="text-sm">Yes</span>
          </div>
        </Labeled>
        {v.work_permit_required && (
          <Labeled label="SafePermit link (Permis de travail)">
            <Input value={v.work_permit_link || ""} onChange={(x)=>set({ work_permit_link: x })} placeholder="https://…" />
          </Labeled>
        )}
      </div>

      <div className="border rounded-xl p-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-sm text-gray-600">Visits</div>
          <input type="number" min={1} className="border rounded px-2 py-1 text-sm w-24"
            value={visitsCount} onChange={(e)=>setVisitsCount(Math.max(1, Number(e.target.value||1)))} />
        </div>
        <div className="grid gap-2">
          {(v.visits || []).map((vis, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input type="date" className="border rounded px-2 py-1 text-sm" value={vis.start || ""} onChange={(e)=> {
                const arr=[...v.visits]; arr[i]={...arr[i], start: e.target.value}; set({ visits: arr, visits_slots: visitsCount });
              }} />
              <input type="date" className="border rounded px-2 py-1 text-sm" value={vis.end || ""} onChange={(e)=> {
                const arr=[...v.visits]; arr[i]={...arr[i], end: e.target.value}; set({ visits: arr, visits_slots: visitsCount });
              }} />
            </div>
          ))}
        </div>
      </div>

      {v.id && (
        <div className="border rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Attachments</div>
            <div className="text-xs text-gray-500">Drag & drop files or click</div>
          </div>
          <AttachmentsPanel vendorId={v.id} onChanged={()=>{}} />
        </div>
      )}

      <div className="flex items-center justify-between">
        {onDelete ? (
          <button className="px-3 py-2 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100" onClick={onDelete}>
            Delete vendor
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={()=>onChange(v)}>
            Reset
          </button>
          <button className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentsPanel({ vendorId, onChanged }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("general");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isOver, setIsOver] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await API.listFiles(vendorId, category);
      setFiles(data.files || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [vendorId, category]);

  async function handleUpload(list) {
    if (!list?.length) return;
    setProgress(0);
    await API.uploadFiles(vendorId, Array.from(list), category, setProgress);
    await load();
    if (onChanged) onChanged();
  }
  function onDrop(e) {
    e.preventDefault();
    setIsOver(false);
    if (e.dataTransfer?.files?.length) handleUpload(e.dataTransfer.files);
  }

  return (
    <div className="bg-white border rounded-xl p-3 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Category</span>
          <Select value={category} onChange={setCategory} options={["general","offre","msra","pp","acces","sap","autre"]} className="w-40" />
        </div>
      </div>

      <div
        onDragOver={(e)=>{ e.preventDefault(); setIsOver(true); }}
        onDragLeave={()=>setIsOver(false)}
        onDrop={onDrop}
        className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition
          ${isOver ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"}`}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl">📂</div>
          <div className="text-sm text-gray-600">Drop your files here</div>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition">
            <input type="file" multiple className="hidden" onChange={(e)=>handleUpload(e.target.files)} />
            <span>Select files</span>
          </label>
        </div>
        {!!progress && progress<100 && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-gray-500 mt-1">Uploading… {progress}%</div>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading && <div className="text-gray-500">Loading…</div>}
        {!loading && files.length === 0 && <div className="text-gray-500">No files.</div>}
        {files.map((f) => <FileCard key={f.id} f={f} onDelete={async ()=>{ await API.deleteFile(f.id); await load(); if (onChanged) onChanged(); }} />)}
      </div>
    </div>
  );
}

function FileCard({ f, onDelete }) {
  const isImage = (f.mime || "").startsWith("image/");
  const sizeKB = Math.max(1, Math.round(Number(f.size_bytes || 0) / 1024));
  const url = f.download_url || f.inline_url || f.url;
  return (
    <div className="border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage ? <img src={url} alt={f.original_name} className="w-full h-full object-cover" /> : <div className="text-4xl">📄</div>}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={f.original_name}>{f.original_name}</div>
        <div className="text-xs text-gray-500 mt-0.5">{sizeKB} KB • {f.mime || "file"}</div>
        <div className="flex items-center gap-2 mt-2">
          <a href={url} className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition" download>
            Download
          </a>
          <button onClick={onDelete} className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------- Charts data builders -----------------
function donutData(obj, colors) {
  const labels = Object.keys(obj);
  const data = labels.map((k) => obj[k] || 0);
  const palette = colors || ["#93c5fd", "#34d399", "#fbbf24"];
  return {
    labels,
    datasets: [
      { data, backgroundColor: palette, borderColor: palette, borderWidth: 1.5, hoverOffset: 8 },
    ],
  };
}
function barData(obj, colors) {
  const labels = Object.keys(obj);
  const data = labels.map((k) => obj[k] || 0);
  const [c1, c2] = colors || ["#f43f5e", "#10b981"];
  return {
    labels,
    datasets: [
      { label: "Access", data, backgroundColor: [c1, c2], borderColor: [c1, c2], borderWidth: 1.5, borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.6 },
    ],
  };
}
