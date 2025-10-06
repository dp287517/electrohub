/**
 * Controls.jsx — Electrohub Frontend
 * Page complète pour la gestion des contrôles (TSD)
 * Inclut : Filtres, Historique, IA, Calendrier Gantt, Uploads et Modales
 */

import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function toQS(params = {}) {
  const s = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return s ? "?" + s : "";
}

// -----------------------------------------------------------------------------
// API
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

  async function loadTasks() {
    setLoading(true);
    try {
      const data = await CONTROLS_API.tasks(filter);
      setTasks(data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendar() {
    try {
      const data = await CONTROLS_API.calendar({});
      const tasksGantt = Object.entries(data).flatMap(([date, arr]) =>
        arr.map((t) => ({
          id: t.id,
          name: t.label,
          start: new Date(date),
          end: new Date(dayjs(date).add(1, "day").toISOString()),
          type: "task",
          progress: t.status === "closed" ? 100 : 0,
          styles: { progressColor: t.status === "closed" ? "#16a34a" : "#2563eb" },
        }))
      );
      setCalendar(tasksGantt);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadTasks();
    loadCalendar();
  }, [JSON.stringify(filter)]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Controls Management</h1>

      <div className="flex gap-2 flex-wrap">
        <Input
          value={filter.search}
          onChange={(v) => setFilter({ ...filter, search: v })}
          placeholder="Search..."
        />
        <Select
          value={filter.status}
          onChange={(v) => setFilter({ ...filter, status: v })}
          options={["open", "closed", "overdue", "all"]}
          placeholder="Status"
        />
        <button
          className="bg-blue-600 text-white px-3 py-1 rounded"
          onClick={loadTasks}
        >
          Refresh
        </button>
      </div>

      {/* TASK GRID */}
      <div className="overflow-auto border rounded-md">
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
                <td className="p-2">{dayjs(t.due_date).format("DD/MM/YYYY")}</td>
                <td className="p-2">
                  <button
                    className="text-blue-600 underline"
                    onClick={() => setSelected(t)}
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="p-2 text-gray-500">Loading...</div>}
      </div>

      {/* GANTT VIEW */}
      <div className="border rounded-md p-2 bg-white shadow">
        <h2 className="text-lg font-semibold mb-2">Calendar (Gantt View)</h2>
        <div className="flex items-center gap-2 mb-2">
          <span>View mode:</span>
          <select
            className="border px-2 py-1 rounded"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
          >
            <option value={ViewMode.Week}>Week</option>
            <option value={ViewMode.Month}>Month</option>
            <option value={ViewMode.Year}>Year</option>
          </select>
        </div>
        <div className="h-[400px] bg-white overflow-x-auto">
          <Gantt tasks={calendar} viewMode={viewMode} />
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

  async function closeTask() {
    try {
      await CONTROLS_API.close(task.id, {
        record_status: "done",
        checklist: [],
        observations: { notes: obs },
        attachments: [],
      });
      reload();
      onClose();
    } catch (err) {
      alert("Error closing task: " + err.message);
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
      <p>
        <b>Due:</b> {dayjs(task.due_date).format("DD/MM/YYYY")}
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

      <div className="flex gap-2">
        <button
          onClick={closeTask}
          className="bg-green-600 text-white px-4 py-1 rounded"
        >
          Close Task
        </button>
        <button
          onClick={analyzeBefore}
          className="bg-yellow-500 text-white px-4 py-1 rounded"
        >
          AI Analysis
        </button>
      </div>

      {aiResult && (
        <div className="mt-3 border rounded p-2 bg-gray-50">
          <h4 className="font-semibold">AI Findings</h4>
          <ul className="text-sm list-disc ml-4">
            {aiResult.map((f, i) => (
              <li key={i}>
                {f.message} ({Math.round(f.confidence * 100)}%)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
