// src/pages/Comp.jsx
// External Contractors (Prestataires externes)
// ✔ Onglets : Vendors | Planning | Analytics
// ✔ Responsive premium : mobile-first, sections empilées, table -> cartes mobile
// ✔ Graphiques colorés + grands (empilés verticalement)
// ✔ Vrai calendrier mensuel (nav, Today, événements par jour)
// ✔ Gantt fiable (ISO -> Date)
// ✔ Drag & drop multi-fichiers + aperçu + progression

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
};

// ----------------- UI helpers -----------------
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
      {T("planning", "Planning", "📅")}
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
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[color] || map.gray}`}>
      {children}
    </span>
  );
}
const statusColor = {
  offre: (s) => (s === "po_faite" ? "green" : s?.startsWith("re") ? "blue" : "yellow"),
  jsa: (s) => (s === "signe" ? "green" : s === "receptionne" ? "blue" : "yellow"),
  access: (s) => (s === "fait" ? "green" : "red"),
};

// Palette explicite (charts colorés)
const palette = {
  emerald: "rgba(16,185,129,0.85)",
  emeraldLine: "rgba(16,185,129,1)",
  blue: "rgba(59,130,246,0.85)",
  blueLine: "rgba(59,130,246,1)",
  amber: "rgba(245,158,11,0.85)",
  amberLine: "rgba(245,158,11,1)",
  rose: "rgba(244,63,94,0.85)",
  roseLine: "rgba(244,63,94,1)",
  slateGrid: "rgba(148,163,184,0.25)",
};

// Chart options premium (inspiré de ta page Obsolescence)
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

// ----------------- Month Calendar (sans dépendance externe) -----------------
function MonthCalendar({ events = [] }) {
  const [month, setMonth] = useState(dayjs()); // mois courant
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) {
      (map[e.date] ||= []).push(e);
    }
    return map;
  }, [events]);

  // lundi = 0
  const startOfMonth = month.startOf("month").toDate();
  const endOfMonth = month.endOf("month").toDate();
  const startDow = (startOfMonth.getDay() + 6) % 7; // 0..6 (Mon..Sun)
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
        <div className="text-lg font-semibold">
          {month.format("MMMM YYYY")}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded border hover:bg-gray-50"
            onClick={() => setMonth((m) => m.subtract(1, "month"))}
          >
            ← Prev
          </button>
          <button className="px-3 py-1.5 rounded border hover:bg-gray-50" onClick={() => setMonth(dayjs())}>
            Today
          </button>
          <button
            className="px-3 py-1.5 rounded border hover:bg-gray-50"
            onClick={() => setMonth((m) => m.add(1, "month"))}
          >
            Next →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-xs font-medium text-gray-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l) => (
          <div key={l} className="px-2 py-2">
            {l}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 border rounded-xl overflow-hidden">
        {days.map(({ d, iso, inMonth }) => {
          const list = eventsByDate[iso] || [];
          return (
            <div
              key={iso}
              className={`min-h-[88px] p-2 border-t border-l last:border-r
                ${inMonth ? "bg-white" : "bg-gray-50"}
              `}
            >
              <div className="flex items-center justify-between">
                <div className={`text-xs ${inMonth ? "text-gray-700" : "text-gray-400"}`}>
                  {dayjs(d).format("D")}
                </div>
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
                    className="truncate text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                    title={e.label}
                  >
                    {e.label}
                  </div>
                ))}
                {list.length > 3 && (
                  <div className="text-[11px] text-gray-500">+{list.length - 3} more…</div>
                )}
              </div>
            </div>
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
  const [filter, setFilter] = useState({ q: "" });
  const [creating, setCreating] = useState({ name: "" });

  const [calendar, setCalendar] = useState({ tasks: [], events: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const offerOptions = ["en_attente", "reçue", "po_faite"];
  const jsaOptions = ["transmis", "receptionne", "signe"];
  const accessOptions = ["a_faire", "fait"];

  async function reloadVendors() {
    const data = await API.list(filter);
    setList(Array.isArray(data.items) ? data.items : []);
  }
  async function reloadPlanning() {
    const data = await API.calendar();
    // Convert ISO -> Date for Gantt
    const tasks = (data.tasks || []).map((t) => ({
      ...t,
      start: new Date(t.start),
      end: new Date(t.end),
      type: "task",
      progress: 0,
    }));
    setCalendar({ tasks, events: data.events || [] });
  }
  async function reloadAnalytics() {
    setStats(await API.stats());
  }
  async function reloadAll() {
    setLoading(true);
    try {
      await Promise.all([reloadVendors(), reloadPlanning(), reloadAnalytics()]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reloadAll();
  }, []);

  // Lazy refresh per tab switch
  useEffect(() => {
    if (tab === "planning") reloadPlanning();
    if (tab === "analytics") reloadAnalytics();
  }, [tab]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">External Contractors</h1>
          <p className="text-gray-500 text-sm">
            Vendors offers, JSA, prevention plan, access, visits, SAP WO & attachments
          </p>
        </div>
        <Tabs value={tab} onChange={setTab} />
      </header>

      {/* VENDORS */}
      {tab === "vendors" && (
        <>
          <div className="bg-white rounded-2xl border shadow-sm p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <Input
                value={filter.q}
                onChange={(v) => setFilter((s) => ({ ...s, q: v }))}
                placeholder="Search vendor…"
              />
              <div className="flex gap-2">
                <button
                  className="px-3 py-2 rounded border hover:bg-gray-50"
                  onClick={() => {
                    setFilter({ q: "" });
                    reloadVendors();
                  }}
                >
                  Reset
                </button>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={reloadVendors}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={creating.name}
                onChange={(v) => setCreating({ ...creating, name: v })}
                placeholder="New vendor name"
                className="w-full sm:w-64"
              />
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={async () => {
                  if (!creating.name?.trim()) return;
                  await API.create({ name: creating.name.trim() });
                  setCreating({ name: "" });
                  await reloadVendors();
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Table desktop */}
          <div className="hidden md:block bg-white rounded-2xl border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700 sticky top-[100px] z-10">
                <tr>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Offer</th>
                  <th className="p-2 text-left">JSA</th>
                  <th className="p-2 text-left">Prevention plan</th>
                  <th className="p-2 text-left">Access</th>
                  <th className="p-2 text-left">SAP WO</th>
                  <th className="p-2 text-left">Visits</th>
                  <th className="p-2 text-left">Owner</th>
                  <th className="p-2 text-left">Files</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <VendorRow
                    key={v.id}
                    v={v}
                    offerOptions={offerOptions}
                    jsaOptions={jsaOptions}
                    accessOptions={accessOptions}
                    onSaved={reloadAll}
                    onDelete={async () => {
                      await API.remove(v.id);
                      await reloadAll();
                    }}
                  />
                ))}
                {!loading && (!list || list.length === 0) && (
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
              </tbody>
            </table>
          </div>

          {/* Cartes mobile */}
          <div className="md:hidden grid grid-cols-1 gap-4">
            {list.map((v) => (
              <VendorCard
                key={v.id}
                v={v}
                offerOptions={offerOptions}
                jsaOptions={jsaOptions}
                accessOptions={accessOptions}
                onSaved={reloadAll}
                onDelete={async () => {
                  await API.remove(v.id);
                  await reloadAll();
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* PLANNING : EMPILÉ (calendrier plein + Gantt plein) */}
      {tab === "planning" && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Calendar (Month view)">
            <MonthCalendar events={calendar.events} />
          </Card>
          <Card
            title="Gantt"
            actions={
              <select
                className="border rounded px-2 py-1 text-sm"
                value={Object.keys(ViewMode).find((k) => ViewMode[k] === viewMode) || "Month"}
                onChange={(e) =>
                  setViewMode(
                    { Week: ViewMode.Week, Month: ViewMode.Month, Year: ViewMode.Year }[e.target.value] ||
                      ViewMode.Month
                  )
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
                <Gantt tasks={calendar.tasks} viewMode={viewMode} />
              ) : (
                <div className="text-sm text-gray-500">No planned visits.</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ANALYTICS : EMPILÉ (grands graphiques colorés) */}
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
                data={donutData(stats?.counts?.jsa || { transmis: 0, receptionne: 0, signe: 0 }, [
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
              <Bar
                data={barData(stats?.counts?.access || { a_faire: 0, fait: 0 }, [
                  palette.rose,
                  palette.emerald,
                ])}
                options={barOptions}
              />
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

// ----------------- Reusable -----------------
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

function VendorRow({ v, onSaved, onDelete, offerOptions, jsaOptions, accessOptions }) {
  const [edit, setEdit] = useState(v);
  const [editing, setEditing] = useState(false);
  const [visitCount, setVisitCount] = useState(v?.visits?.length || 1);
  const [showAttach, setShowAttach] = useState(false);

  useEffect(() => {
    setEdit(v);
    setVisitCount(v?.visits?.length || 1);
  }, [v?.id]);

  useEffect(() => {
    setEdit((e) => {
      const base = e?.visits || [];
      const arr = Array.from({ length: visitCount }).map((_, i) => ({
        index: i + 1,
        start: base[i]?.start || "",
        end: base[i]?.end || base[i]?.start || "",
      }));
      return { ...e, visits: arr };
    });
  }, [visitCount]);

  async function save() {
    const payload = {
      ...edit,
      visits: (edit.visits || []).map((x) => ({
        index: x.index,
        start: x.start || null,
        end: x.end || x.start || null,
      })),
    };
    await API.update(v.id, payload);
    setEditing(false);
    if (onSaved) onSaved();
  }

  return (
    <tr className="border-t border-gray-100 align-top hover:bg-gray-50/50 transition">
      <td className="p-2 min-w-[180px]">
        <Input value={edit.name || ""} onChange={(x) => setEdit({ ...edit, name: x })} disabled={!editing} />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select
            value={edit.offer_status || "en_attente"}
            onChange={(x) => setEdit({ ...edit, offer_status: x })}
            options={offerOptions}
            disabled={!editing}
          />
          <Badge color={statusColor.offre(edit.offer_status || "en_attente")}>
            {edit.offer_status || "en_attente"}
          </Badge>
        </div>
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select
            value={edit.jsa_status || "transmis"}
            onChange={(x) => setEdit({ ...edit, jsa_status: x })}
            options={jsaOptions}
            disabled={!editing}
          />
        </div>
        <div className="mt-1">
          <Badge color={statusColor.jsa(edit.jsa_status || "transmis")}>
            {edit.jsa_status || "transmis"}
          </Badge>
        </div>
      </td>
      <td className="p-2">
        <label className="flex items-center gap-2 mb-1 text-sm">
          <input
            type="checkbox"
            checked={!!edit.pp_applicable}
            onChange={(e) => setEdit({ ...edit, pp_applicable: e.target.checked })}
            disabled={!editing}
          />
          Applicable
        </label>
        {edit.pp_applicable && (
          <Input
            value={edit.pp_link || ""}
            onChange={(x) => setEdit({ ...edit, pp_link: x })}
            placeholder="SafePermit link"
            disabled={!editing}
          />
        )}
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select
            value={edit.access_status || "a_faire"}
            onChange={(x) => setEdit({ ...edit, access_status: x })}
            options={accessOptions}
            disabled={!editing}
          />
          <Badge color={statusColor.access(edit.access_status || "a_faire")}>
            {edit.access_status || "a_faire"}
          </Badge>
        </div>
      </td>
      <td className="p-2">
        <Input
          value={edit.sap_wo || ""}
          onChange={(x) => setEdit({ ...edit, sap_wo: x })}
          placeholder="Upcoming WO"
          disabled={!editing}
        />
      </td>
      <td className="p-2 min-w-[260px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-600">Visits</span>
          <input
            type="number"
            min={1}
            className="border rounded px-2 py-1 text-sm w-20"
            value={visitCount}
            onChange={(e) => setVisitCount(Math.max(1, Number(e.target.value || 1)))}
            disabled={!editing}
          />
        </div>
        <div className="space-y-2">
          {(edit.visits || []).map((vis, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm"
                value={vis.start || ""}
                onChange={(e) => {
                  const v2 = [...edit.visits];
                  v2[i] = { ...v2[i], start: e.target.value };
                  setEdit({ ...edit, visits: v2 });
                }}
                disabled={!editing}
              />
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm"
                value={vis.end || ""}
                onChange={(e) => {
                  const v2 = [...edit.visits];
                  v2[i] = { ...v2[i], end: e.target.value };
                  setEdit({ ...edit, visits: v2 });
                }}
                disabled={!editing}
              />
            </div>
          ))}
        </div>
      </td>
      <td className="p-2">
        <Input
          value={edit.owner || ""}
          onChange={(x) => setEdit({ ...edit, owner: x })}
          placeholder="Owner"
          disabled={!editing}
        />
      </td>
      <td className="p-2">
        <button
          className="px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 transition"
          onClick={() => setShowAttach((s) => !s)}
        >
          📎 Files {v.files_count ? <Badge color="purple">{v.files_count}</Badge> : null}
        </button>
        {showAttach && <AttachmentsPanel vendorId={v.id} onChanged={onSaved} />}
      </td>
      <td className="p-2">
        <div className="flex flex-col gap-2">
          {!editing ? (
            <button
              className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 transition"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition"
                onClick={save}
              >
                Save
              </button>
              <button
                className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition"
                onClick={() => {
                  setEdit(v);
                  setVisitCount(v?.visits?.length || 1);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <button
            className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function VendorCard(props) {
  const { v, onSaved, onDelete, offerOptions, jsaOptions, accessOptions } = props;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-semibold">{v.name}</div>
          <div className="text-xs text-gray-500">Owner: {v.owner || "—"}</div>
        </div>
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setExpanded((o) => !o)}>
          {expanded ? "Hide" : "Details"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3">
          <VendorRow
            v={v}
            onSaved={onSaved}
            onDelete={onDelete}
            offerOptions={offerOptions}
            jsaOptions={jsaOptions}
            accessOptions={accessOptions}
          />
        </div>
      )}
      <div className="mt-3">
        <button
          className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
          onClick={onDelete}
        >
          Delete
        </button>
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
  const boxRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const data = await API.listFiles(vendorId, category);
      setFiles(data.files || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [vendorId, category]);

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
    <div className="mt-2 bg-white border rounded-xl p-3 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Category</span>
          <Select
            value={category}
            onChange={setCategory}
            options={["general", "offre", "jsa", "pp", "acces", "sap", "autre"]}
            className="w-40"
          />
        </div>
        <div className="text-xs text-gray-500">Drag & drop files or click</div>
      </div>

      <div
        ref={boxRef}
        onDragOver={(e) => {
          e.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={onDrop}
        className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition
          ${isOver ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"}`}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl">📂</div>
          <div className="text-sm text-gray-600">Drop your files here</div>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition">
            <input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
            <span>Select files</span>
          </label>
        </div>
        {!!progress && progress < 100 && (
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
        {files.map((f) => (
          <FileCard
            key={f.id}
            f={f}
            onDelete={async () => {
              await API.deleteFile(f.id);
              await load();
              if (onChanged) onChanged();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FileCard({ f, onDelete }) {
  const isImage = (f.mime || "").startsWith("image/");
  const sizeKB = Math.max(1, Math.round(Number(f.size_bytes || 0) / 1024));
  return (
    <div className="border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img src={f.url} alt={f.original_name} className="w-full h-full object-cover" />
        ) : (
          <div className="text-4xl">📄</div>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={f.original_name}>
          {f.original_name}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {sizeKB} KB • {f.mime || "file"}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <a
            href={f.url}
            className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
            download
          >
            Download
          </a>
          <button
            onClick={onDelete}
            className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------- Charts data builders (avec couleurs) -----------------
function donutData(obj, colors) {
  const labels = Object.keys(obj);
  const data = labels.map((k) => obj[k] || 0);
  const palette = colors || ["#93c5fd", "#34d399", "#fbbf24"];
  return {
    labels,
    datasets: [
      {
        data,
        backgroundColor: palette,
        borderColor: palette.map((c) => c.replace("0.85", "1")),
        borderWidth: 1.5,
        hoverOffset: 8,
      },
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
      {
        label: "Access",
        data,
        backgroundColor: [c1, c2],
        borderColor: [c1, c2],
        borderWidth: 1.5,
        borderRadius: 8,
        barPercentage: 0.6,
        categoryPercentage: 0.6,
      },
    ],
  };
}
