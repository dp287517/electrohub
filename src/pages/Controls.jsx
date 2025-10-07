/**
 * Controls.jsx — Electrohub (frontend)
 * UI complète et stylée pour la gestion des contrôles (TSD)
 *
 * Dépendances:
 *   react, dayjs, uuid, gantt-task-react
 *   CSS: Tailwind recommandé (classes utilisées), sinon les classes restent inertes sans casser le rendu
 *
 * Backends attendus (déjà fournis dans server_controls.js):
 *   GET  /api/controls/tasks
 *   GET  /api/controls/calendar
 *   GET  /api/controls/tasks/:id/schema
 *   GET  /api/controls/tasks/:id/history
 *   PATCH /api/controls/tasks/:id/close
 *   GET  /api/controls/bootstrap/seed?dry_run=1|0
 *   POST /api/controls/ai/analyze-before (multipart/form-data: file?, task_id?, attach?)
 *   POST /api/controls/ai/read-value     (multipart/form-data: file?, task_id?, meter_type?, unit_hint?, attach?)
 */

import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

const API_BASE = "/api/controls";

// ----------------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------------
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
const CONTROLS_API = {
  tasks: (params = {}) => fetchJSON(`${API_BASE}/tasks${toQS(params)}`),
  calendar: (params = {}) => fetchJSON(`${API_BASE}/calendar${toQS(params)}`),
  schema: (id) => fetchJSON(`${API_BASE}/tasks/${id}/schema`),
  history: (id) => fetchJSON(`${API_BASE}/tasks/${id}/history`),
  close: (id, payload) => fetchJSON(`${API_BASE}/tasks/${id}/close`, { method: "PATCH", body: JSON.stringify(payload) }),
  seed: (params = {}) => fetchJSON(`${API_BASE}/bootstrap/seed${toQS(params)}`),

  analyzeBefore: async ({ file, task_id, attach = false, hints = [] }) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (task_id) fd.append("task_id", task_id);
    fd.append("attach", attach ? "1" : "0");
    fd.append("hints", JSON.stringify(hints));
    const res = await fetch(`${API_BASE}/ai/analyze-before`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  readValue: async ({ file, task_id, meter_type = "multimeter_voltage", unit_hint = "V", attach = false }) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (task_id) fd.append("task_id", task_id);
    fd.append("meter_type", meter_type);
    fd.append("unit_hint", unit_hint);
    fd.append("attach", attach ? "1" : "0");
    const res = await fetch(`${API_BASE}/ai/read-value`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

// ----------------------------------------------------------------------------------
// UI bits
// ----------------------------------------------------------------------------------
function Badge({ tone = "gray", children }) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-1 ring-gray-200",
    blue: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
    green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    yellow: "bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200",
    red: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  };
  return <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${map[tone]}`}>{children}</span>;
}
function Button({ children, onClick, tone = "primary", className = "", disabled = false, type = "button" }) {
  const map = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-white hover:bg-gray-50 text-gray-900 ring-1 ring-gray-300",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white",
    warn: "bg-yellow-500 hover:bg-yellow-600 text-white",
    danger: "bg-rose-600 hover:bg-rose-700 text-white",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-sm shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition ${map[tone]} ${className}`}
    >
      {children}
    </button>
  );
}
function Input({ value, onChange, placeholder, className = "" }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`border border-gray-300 rounded-xl px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-300 outline-none ${className}`}
    />
  );
}
function Select({ value, onChange, options, placeholder = "Select...", className = "" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`border border-gray-300 rounded-xl px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-300 outline-none ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
function TextArea({ value, onChange, rows = 4, placeholder = "" }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="border border-gray-300 rounded-xl px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-300 outline-none"
    />
  );
}
function Card({ title, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden">
        <div className="flex justify-end p-3">
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
            aria-label="Fermer"
            title="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="px-6 pb-6 -mt-4">{children}</div>
      </div>
    </div>
  );
}

// Tabs
function Tabs({ tabs, current, onChange }) {
  return (
    <div className="flex gap-2 border-b border-gray-200">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-2 text-sm font-medium rounded-t-xl
            ${current === t ? "bg-white border border-b-white border-gray-200" : "text-gray-600 hover:text-gray-900"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------------
export default function Controls() {
  const [tasks, setTasks] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [viewMode, setViewMode] = useState(ViewMode.Month);

  const [filter, setFilter] = useState({ status: "all", search: "" }); // défaut all
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [seedLog, setSeedLog] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const [selected, setSelected] = useState(null);

  const VIEW_OPTIONS = { Week: ViewMode.Week, Month: ViewMode.Month, Year: ViewMode.Year };

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
      setTasks([]);
      setError(err.message || "Erreur de chargement des tâches");
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendar() {
    try {
      const data = await CONTROLS_API.calendar({});
      const tasksGantt = Object.values(data)
        .flat()
        .filter((t) => t && t.id && t.label && t.due_date)
        .map((t) => {
          const start = new Date(t.due_date);
          const end = new Date(dayjs(t.due_date).add(1, "day").toISOString());
          return { id: String(t.id), name: t.label, start, end, type: "task", progress: t.status === "Done" ? 100 : 0 };
        });
      setCalendar(tasksGantt);
    } catch (e) {
      setCalendar([]);
    }
  }

  async function doSeed(dryRun = true) {
    setSeeding(true);
    setError("");
    setSeedLog(null);
    try {
      const resp = await CONTROLS_API.seed({ dry_run: dryRun ? 1 : 0, category: "ALL" });
      setSeedLog(resp);
      if (!dryRun) {
        await loadTasks();
        await loadCalendar();
      }
    } catch (e) {
      setError(e.message || "Erreur seed");
    } finally {
      setSeeding(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    void loadCalendar();
  }, [JSON.stringify(filter)]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Controls (TSD)</h1>
          <p className="text-gray-500 text-sm">Planification, exécution et historique des contrôles</p>
        </div>
        <div className="flex items-center gap-2">
          <Button tone="secondary" onClick={() => setFilter({ ...filter, status: "all" })}>Tout</Button>
          <Button tone="secondary" onClick={() => setFilter({ ...filter, status: "open" })}>Ouverts</Button>
          <Button tone="secondary" onClick={() => setFilter({ ...filter, status: "overdue" })}>En retard</Button>
          <Button tone="secondary" onClick={() => setFilter({ ...filter, status: "closed" })}>Clos</Button>
          <Button tone="primary" onClick={loadTasks}>Actualiser</Button>
        </div>
      </div>

      {/* Bandeau seed */}
      <Card
        title="Base vide ? Seed TSD (toutes catégories)"
        right={<Badge tone="yellow">{seedLog ? `Entités: ${seedLog.count_entities ?? 0} • actions: ${seedLog.actions?.length ?? 0}` : "—"}</Badge>}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-700">
            Le seed crée des tâches “Planned” pour chaque entité selon la TSD (LV, ATEX, HV, etc.).
          </span>
          <Button tone="warn" disabled={seeding} onClick={() => doSeed(true)}>
            {seeding ? "Analyse…" : "Simuler (dry-run)"}
          </Button>
          <Button tone="success" disabled={seeding} onClick={() => doSeed(false)}>
            {seeding ? "Création…" : "Créer tâches TSD"}
          </Button>
          {error && <span className="text-rose-600 text-sm">{error}</span>}
        </div>
      </Card>

      {/* Filtres */}
      <Card title="Filtres">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input value={filter.search} onChange={(v) => setFilter({ ...filter, search: v })} placeholder="Recherche (label, type)..." />
          <Select value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })} options={["all","open","overdue","closed"]} placeholder="Status" />
          <div className="flex items-center gap-2">
            <Button tone="secondary" onClick={() => setFilter({ status: "all", search: "" })}>Réinitialiser</Button>
          </div>
        </div>
      </Card>

      {/* Liste + Gantt */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card
          title="Tâches"
          right={<span className="text-sm text-gray-500">{loading ? "Chargement..." : `${tasks.length} tâche(s)`}</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-2">Label</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Due</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="p-2">{t.label}</td>
                    <td className="p-2">{t.task_code || "—"}</td>
                    <td className="p-2">
                      {t.status === "Done" ? <Badge tone="green">Closed</Badge>
                        : ["Planned","Pending","Overdue"].includes(t.status) ? <Badge tone="blue">Open</Badge>
                        : <Badge tone="gray">—</Badge>}
                    </td>
                    <td className="p-2">{t.due_date ? dayjs(t.due_date).format("DD/MM/YYYY") : "—"}</td>
                    <td className="p-2">
                      <Button tone="secondary" onClick={() => setSelected(t)}>Détails</Button>
                    </td>
                  </tr>
                ))}
                {(!tasks || tasks.length === 0) && (
                  <tr>
                    <td colSpan={5} className="p-3 text-gray-500">Aucune tâche.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Calendrier (Gantt)"
          right={
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Vue</span>
              <select
                className="border border-gray-300 rounded-xl px-3 py-1 text-sm"
                value={Object.keys(ViewMode).find((k) => ViewMode[k] === viewMode) || "Month"}
                onChange={(e) => setViewMode({ Week: ViewMode.Week, Month: ViewMode.Month, Year: ViewMode.Year }[e.target.value] || ViewMode.Month)}
              >
                <option value="Week">Week</option>
                <option value="Month">Month</option>
                <option value="Year">Year</option>
              </select>
            </div>
          }
        >
          <div className="h-[420px] overflow-x-auto">
            {Array.isArray(calendar) && calendar.length > 0 ? (
              <Gantt tasks={calendar} viewMode={viewMode} />
            ) : (
              <div className="text-sm text-gray-500">Aucune tâche planifiée.</div>
            )}
          </div>
        </Card>
      </div>

      {/* Détails */}
      <Modal open={!!selected} onClose={() => setSelected(null)}>
        {selected && <TaskModal task={selected} onClose={() => setSelected(null)} reload={() => { loadTasks(); loadCalendar(); }} />}
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------------------------
// Task Modal
// ----------------------------------------------------------------------------------
function TaskModal({ task, onClose, reload }) {
  const [tab, setTab] = useState("Résumé");
  const [schema, setSchema] = useState(null);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // checklist state (objet: key-> "Conforme"/"Non conforme"/"Non applicable")
  const [checkState, setCheckState] = useState({});
  const [obsText, setObsText] = useState("");

  // IA - analyze-before
  const [beforeFile, setBeforeFile] = useState(null);
  const [beforeAttach, setBeforeAttach] = useState(true);
  const [beforePreview, setBeforePreview] = useState(null);
  const [aiResult, setAiResult] = useState(null);

  // IA - read-value
  const [meterFile, setMeterFile] = useState(null);
  const [meterAttach, setMeterAttach] = useState(true);
  const [meterPreview, setMeterPreview] = useState(null);
  const [meterType, setMeterType] = useState("multimeter_voltage");
  const [unitHint, setUnitHint] = useState("V");
  const [meterResult, setMeterResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [sc, hi] = await Promise.all([
          CONTROLS_API.schema(task.id),
          CONTROLS_API.history(task.id),
        ]);
        setSchema(sc);
        setHistory(hi || []);
        // init checklist
        const init = {};
        (sc?.checklist || []).forEach((item) => { init[item.key || item.label || item.id || uuidv4()] = ""; });
        setCheckState(init);
      } catch (e) {
        setErr(e.message || "Erreur chargement schéma/historique");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    if (beforeFile) {
      const url = URL.createObjectURL(beforeFile);
      setBeforePreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setBeforePreview(null);
    }
  }, [beforeFile]);

  useEffect(() => {
    if (meterFile) {
      const url = URL.createObjectURL(meterFile);
      setMeterPreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setMeterPreview(null);
    }
  }, [meterFile]);

  async function closeTask() {
    setSaving(true);
    setErr("");
    try {
      // checklist as array of {key,label,value}
      const checklist = (schema?.checklist || []).map((item) => ({
        key: item.key || item.label || item.id,
        label: item.label || item.text || item.key || "",
        value: checkState[item.key || item.label || item.id] || "",
      }));
      const observations = {
        notes: obsText,
      };
      await CONTROLS_API.close(task.id, {
        record_status: "done",
        checklist,
        observations,
        attachments: [], // upload direct via /attachments si besoin
      });
      await reload();
      onClose();
    } catch (e) {
      setErr(e.message || "Erreur lors de la clôture");
    } finally {
      setSaving(false);
    }
  }

  async function doAnalyzeBefore() {
    setAiResult(null);
    setErr("");
    try {
      const out = await CONTROLS_API.analyzeBefore({
        file: beforeFile,
        task_id: task.id,
        attach: beforeAttach,
        hints: [],
      });
      setAiResult(out);
    } catch (e) {
      setErr(e.message || "Erreur analyse IA");
    }
  }

  async function doReadValue() {
    setMeterResult(null);
    setErr("");
    try {
      const out = await CONTROLS_API.readValue({
        file: meterFile,
        task_id: task.id,
        meter_type: meterType,
        unit_hint: unitHint,
        attach: meterAttach,
      });
      setMeterResult(out);
    } catch (e) {
      setErr(e.message || "Erreur lecture de valeur");
    }
  }

  const statusBadge = task.status === "Done"
    ? <Badge tone="green">Closed</Badge>
    : ["Planned","Pending","Overdue"].includes(task.status)
    ? <Badge tone="blue">Open</Badge>
    : <Badge tone="gray">—</Badge>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{task.label}</h2>
          <div className="text-sm text-gray-600 space-x-2 mt-1">
            <span>Type: <b>{task.task_code || "—"}</b></span>
            <span>• Échéance: <b>{task.due_date ? dayjs(task.due_date).format("DD/MM/YYYY") : "—"}</b></span>
            <span>• {statusBadge}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button tone="secondary" onClick={onClose}>Fermer</Button>
          <Button tone="success" onClick={closeTask} disabled={saving || task.status === "Done"}>
            {saving ? "Clôture…" : "Clôturer la tâche"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={["Résumé", "Checklist", "Procédure", "Historique", "IA"]} current={tab} onChange={setTab} />

      {/* Body */}
      <div className="mt-3">
        {tab === "Résumé" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Informations TSD">
              <ul className="text-sm space-y-1">
                <li><b>Catégorie:</b> {schema?.tsd_category?.label || "—"}</li>
                <li>
                  <b>Fréquence:</b>{" "}
                  {schema?.frequency
                    ? (
                      schema.frequency.min
                        ? `${schema.frequency.min.interval} ${schema.frequency.min.unit} (min)` +
                          (schema.frequency.max ? ` → ${schema.frequency.max.interval} ${schema.frequency.max.unit} (max)` : "")
                        : `${schema.frequency.interval} ${schema.frequency.unit}`
                    )
                    : (task.frequency_months ? `${task.frequency_months} months` : "—")
                  }
                </li>
              </ul>
            </Card>

            <Card title="Sécurité (EPI / Dangers)">
              <div className="text-sm text-gray-800 space-y-2">
                <div>
                  <div className="font-medium text-gray-700 mb-1">EPI</div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 whitespace-pre-wrap">
                    {schema?.ppe_md || "—"}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-700 mb-1">Dangers</div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 whitespace-pre-wrap">
                    {schema?.hazards_md || "—"}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Outils">
              <div className="text-sm p-3 rounded-xl bg-gray-50 border border-gray-100 whitespace-pre-wrap">
                {schema?.tools_md || "—"}
              </div>
            </Card>

            <Card title="Observations (générales)">
              <TextArea value={obsText} onChange={setObsText} rows={5} placeholder="Notes, relevés complémentaires, remarques..." />
            </Card>
          </div>
        )}

        {tab === "Checklist" && (
          <div className="space-y-3">
            {schema?.checklist && schema.checklist.length > 0 ? (
              <div className="space-y-3">
                {schema.checklist.map((item, idx) => {
                  const key = item.key || item.label || item.id || `i_${idx}`;
                  return (
                    <div key={key} className="p-3 rounded-xl border border-gray-100 bg-white shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm">
                          <div className="font-medium">{item.label || item.text || key}</div>
                          {item.hint && <div className="text-gray-500">{item.hint}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={checkState[key] || ""}
                            onChange={(v) => setCheckState({ ...checkState, [key]: v })}
                            options={["Conforme","Non conforme","Non applicable"]}
                            placeholder="Résultat"
                            className="w-44"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-500">Aucune checklist définie pour ce contrôle.</div>
            )}
          </div>
        )}

        {tab === "Procédure" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Procédure">
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-sm">{schema?.procedure_md || "—"}</div>
              </div>
            </Card>
            <Card title="Conseils caméra / prises de vue">
              <ul className="list-disc ml-6 text-sm text-gray-800 space-y-1">
                {(schema?.camera_hints || [
                  "Plan large pour contexte et obstacles.",
                  "Zoom sur connexions / borniers / points de mesure.",
                  "Photo nette de l’afficheur de l’appareil au moment du relevé."
                ]).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </Card>
          </div>
        )}

        {tab === "Historique" && (
          <div className="space-y-2">
            {(!history || history.length === 0) && (
              <div className="text-sm text-gray-500">Pas encore d’historique pour cette tâche.</div>
            )}
            {history.map((h) => (
              <div key={h.id || `${h.task_id}-${h.date}-${h.action}`} className="p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-medium">{h.action}</div>
                    <div className="text-gray-500">{h.user || "system"} • {dayjs(h.date).format("DD/MM/YYYY HH:mm")}</div>
                  </div>
                  <Badge tone="gray">{h.site || "Default"}</Badge>
                </div>
                {h.task_name && <div className="text-sm mt-1 text-gray-700">{h.task_name}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === "IA" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Analyse avant intervention"
              right={<Badge tone="blue">Sécurité & étapes</Badge>}
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input type="file" accept="image/*" onChange={(e) => setBeforeFile(e.target.files?.[0] || null)} />
                  <label className="text-sm flex items-center gap-1">
                    <input type="checkbox" checked={beforeAttach} onChange={(e)=>setBeforeAttach(e.target.checked)} />
                    Joindre à la tâche
                  </label>
                  <Button tone="primary" onClick={doAnalyzeBefore} disabled={!beforeFile}>Analyser</Button>
                </div>
                {beforePreview && (
                  <div className="rounded-xl overflow-hidden border border-gray-200">
                    <img src={beforePreview} alt="preview" className="max-h-64 object-contain w-full bg-black/5" />
                  </div>
                )}
                {aiResult && (
                  <div className="space-y-3">
                    <div>
                      <div className="font-semibold mb-1">EPI</div>
                      <div className="text-sm p-3 rounded-xl bg-gray-50 border border-gray-100 whitespace-pre-wrap">
                        {aiResult?.safety?.ppe || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">Dangers</div>
                      <div className="text-sm p-3 rounded-xl bg-gray-50 border border-gray-100 whitespace-pre-wrap">
                        {aiResult?.safety?.hazards || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">Étapes</div>
                      <ol className="list-decimal ml-6 text-sm space-y-1">
                        {(aiResult?.procedure?.steps || []).map((s, i) => <li key={i}>{s.text}</li>)}
                      </ol>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">Conseils caméra</div>
                      <ul className="list-disc ml-6 text-sm space-y-1">
                        {(aiResult?.procedure?.camera_hints || []).map((h, i) => <li key={i}>{h}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card
              title="Lecture automatique d’une valeur"
              right={<Badge tone="yellow">OCR-ready</Badge>}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Select
                    value={meterType}
                    onChange={setMeterType}
                    options={[
                      "multimeter_voltage",
                      "multimeter_current",
                      "thermometer_ir",
                      "thermal_camera",
                      "insulation_tester",
                    ]}
                    placeholder="Type d’appareil"
                  />
                  <Input value={unitHint} onChange={setUnitHint} placeholder="Unité attendue (ex: V, A, °C, Ω)" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={meterAttach} onChange={(e)=>setMeterAttach(e.target.checked)} />
                    Joindre à la tâche
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="file" accept="image/*" onChange={(e) => setMeterFile(e.target.files?.[0] || null)} />
                  <Button tone="primary" onClick={doReadValue} disabled={!meterFile}>Lire la valeur</Button>
                </div>
                {meterPreview && (
                  <div className="rounded-xl overflow-hidden border border-gray-200">
                    <img src={meterPreview} alt="meter" className="max-h-64 object-contain w-full bg-black/5" />
                  </div>
                )}
                {meterResult && (
                  <div className="space-y-2">
                    <div className="text-sm">
                      <b>Valeur détectée:</b> {meterResult.value_detected !== null ? `${meterResult.value_detected} ${meterResult.unit_hint || ""}` : "—"}
                    </div>
                    <div className="text-sm text-gray-600">
                      <b>Confiance:</b> {meterResult.confidence ? Math.round(meterResult.confidence * 100) + "%" : "—"}
                    </div>
                    {meterResult.suggestions && meterResult.suggestions.length > 0 && (
                      <div>
                        <div className="font-semibold text-sm mb-1">Suggestions</div>
                        <ul className="list-disc ml-6 text-sm">
                          {meterResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {err && <div className="text-rose-600 text-sm">{err}</div>}
    </div>
  );
}
