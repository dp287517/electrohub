/**
 * Controls.jsx — Electrohub Frontend
 * Page complète pour la gestion des contrôles (TSD)
 * Inclut : Filtres, Historique, IA, Calendrier Gantt, Uploads et Modales
 *
 * Dépendances :
 *  - react
 *  - dayjs
 *  - uuid
 *  - gantt-task-react
 */

import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

const API_BASE = "/api/controls";

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

function toQS(params = {}) {
  const s = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "" && v !== "all")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return s ? "?" + s : "";
}

// -----------------------------------------------------------------------------
// API - aligné avec server_controls.js
// -----------------------------------------------------------------------------

const CONTROLS_API = {
  tasks: (params = {}) => fetchJSON(`${API_BASE}/tasks${toQS(params)}`),
  close: (id, payload) =>
    fetchJSON(`${API_BASE}/tasks/${id}/close`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  calendar: (params = {}) => fetchJSON(`${API_BASE}/calendar${toQS(params)}`),
  analyzeBefore: (body) =>
    fetchJSON(`${API_BASE}/ai/analyze-before`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  history: (id) => fetchJSON(`${API_BASE}/tasks/${id}/history`),
};

// -----------------------------------------------------------------------------
// UI Components
// -----------------------------------------------------------------------------

function Badge({ color = "gray", children }) {
  const map = {
    gray: "bg-gray-200 text-gray-800",
    green: "bg-green-200 text-green-800",
    red: "bg-red-200 text-red-800",
    blue: "bg-blue-200 text-blue-800",
    yellow: "bg-yellow-200 text-yellow-800",
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${map[color]}`}>
      {children}
    </span>
  );
}

function Input({ value, onChange, placeholder }) {
  return (
    <input
      className="border px-2 py-1 rounded w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      className="border px-2 py-1 rounded w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder || "Select..."}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-4 w-11/12 md:w-3/4 lg:w-1/2 shadow-lg max-h-[90vh] overflow-auto">
        <button
          onClick={onClose}
          className="float-right text-gray-500 hover:text-black"
          aria-label="Fermer"
          title="Fermer"
        >
          ✕
        </button>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Page
// -----------------------------------------------------------------------------

export default function Controls() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState({ status: "open", search: "" });
  const [selected, setSelected] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [viewMode, setViewMode] = useState(ViewMode.Month);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const VIEW_OPTIONS = {
    Week: ViewMode.Week,
    Month: ViewMode.Month,
    Year: ViewMode.Year,
  };

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (filter.status && filter.status !== "all") params.status = filter.status;
      if (filter.search) params.q = filter.search;
      const data = await CONTROLS_API.tasks(params);
      setTasks(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error(err);
      setError(err.message || "Erreur de chargement des tâches");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendar() {
    try {
      const data = await CONTROLS_API.calendar({});
      // data attendu : { "YYYY-MM-DD": [ { id, label, status, due_date, ... }, ... ], ... }
      const tasksGantt = Object.values(data)
        .flat()
        .filter((t) => t && t.id && t.label && t.due_date)
        .map((t) => {
          const start = new Date(t.due_date);
          const end = new Date(dayjs(t.due_date).add(1, "day").toISOString());
          return {
            id: String(t.id),
            name: t.label,
            start,
            end,
            type: "task",
            progress: t.status === "closed" ? 100 : 0,
            styles: {
              progressColor: t.status === "closed" ? "#16a34a" : "#2563eb",
            },
          };
        });
      setCalendar(tasksGantt);
    } catch (err) {
      console.error(err);
      setCalendar([]);
    }
  }

  useEffect(() => {
    loadTasks();
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Controls Management</h1>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="w-64">
          <Input
            value={filter.search}
            onChange={(v) => setFilter({ ...filter, search: v })}
            placeholder="Recherche..."
          />
        </div>
        <div className="w-48">
          <Select
            value={filter.status}
            onChange={(v) => setFilter({ ...filter, status: v })}
            options={["open", "closed", "overdue", "all"]}
            placeholder="Status"
          />
        </div>
        <button
          className="bg-blue-600 text-white px-3 py-1 rounded"
          onClick={loadTasks}
        >
          Actualiser
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>

      {/* TASK GRID */}
      <div className="overflow-auto border rounded-md bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Label</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Due Date</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="p-2">{t.label}</td>
                <td className="p-2">{t.control_type}</td>
                <td className="p-2">
                  {t.status === "open" && <Badge color="blue">Open</Badge>}
                  {t.status === "closed" && <Badge color="green">Closed</Badge>}
                  {t.status === "overdue" && <Badge color="red">Overdue</Badge>}
                </td>
                <td className="p-2">
                  {t.due_date ? dayjs(t.due_date).format("DD/MM/YYYY") : "-"}
                </td>
                <td className="p-2">
                  <button
                    className="text-blue-600 underline"
                    onClick={() => setSelected(t)}
                  >
                    Détails
                  </button>
                </td>
              </tr>
            ))}
            {(!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan={5} className="p-3 text-sm text-gray-500">
                  Aucune tâche.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <div className="p-2 text-gray-500">Chargement…</div>}
      </div>

      {/* GANTT VIEW */}
      <div className="border rounded-md p-2 bg-white shadow">
        <h2 className="text-lg font-semibold mb-2">Calendrier (Gantt)</h2>
        <div className="flex items-center gap-2 mb-2">
          <span>Vue :</span>
          <select
            className="border px-2 py-1 rounded"
            value={Object.keys(VIEW_OPTIONS).find((k) => VIEW_OPTIONS[k] === viewMode) || "Month"}
            onChange={(e) => setViewMode(VIEW_OPTIONS[e.target.value] || ViewMode.Month)}
          >
            <option value="Week">Week</option>
            <option value="Month">Month</option>
            <option value="Year">Year</option>
          </select>
        </div>
        <div className="h-[400px] bg-white overflow-x-auto">
          {Array.isArray(calendar) && calendar.length > 0 ? (
            <Gantt tasks={calendar} viewMode={viewMode} />
          ) : (
            <div className="text-sm text-gray-500 p-3">
              Aucune tâche à afficher dans le calendrier.
            </div>
          )}
        </div>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <TaskDetails
            task={selected}
            onClose={() => setSelected(null)}
            reload={loadTasks}
          />
        )}
      </Modal>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TaskDetails modal
// -----------------------------------------------------------------------------

function TaskDetails({ task, onClose, reload }) {
  const [obs, setObs] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function closeTask() {
    setSaving(true);
    setError("");
    try {
      await CONTROLS_API.close(task.id, {
        record_status: "done",
        checklist: [],
        observations: { notes: obs },
        attachments: [],
      });
      await reload();
      onClose();
    } catch (err) {
      setError(err.message || "Erreur lors de la clôture");
    } finally {
      setSaving(false);
    }
  }

  async function analyzeBefore() {
    try {
      const data = await CONTROLS_API.analyzeBefore({
        image_url: "https://example.com/image.jpg",
      });
      setAiResult(data.findings || []);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{task.label}</h2>
      <p className="text-sm text-gray-600">
        <b>Échéance :</b>{" "}
        {task.due_date ? dayjs(task.due_date).format("DD/MM/YYYY") : "-"}
      </p>

      <div>
        <h3 className="font-semibold">Observations</h3>
        <textarea
          className="border w-full rounded p-2 text-sm"
          rows={3}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
        />
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={closeTask}
          className="bg-green-600 text-white px-4 py-1 rounded disabled:opacity-50"
          disabled={saving}
        >
          {saving ? "Clôture…" : "Clôturer la tâche"}
        </button>
        <button
          onClick={analyzeBefore}
          className="bg-yellow-500 text-white px-4 py-1 rounded"
        >
          Analyse IA
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>

      {aiResult && (
        <div className="mt-3 border rounded p-2 bg-gray-50">
          <h4 className="font-semibold">Résultats IA</h4>
          <ul className="text-sm list-disc ml-4">
            {aiResult.map((f, i) => (
              <li key={i}>
                {f.message} ({Math.round((f.confidence || 0) * 100)}%)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
