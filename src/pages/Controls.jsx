// src/pages/Controls.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { api, get } from "../lib/api.js";
import { RefreshCcw, X, Upload, Search, Filter, ImageDown, MessageSquareText } from "lucide-react";

/** UI primitives (sans shadcn) */
function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm font-medium ${
        active ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
function Card({ children, className = "" }) {
  return <div className={`border rounded-xl bg-white shadow ${className}`}>{children}</div>;
}
function CardBody({ children, className = "" }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
function Badge({ tone = "default", children }) {
  const cls = {
    default: "bg-gray-100 text-gray-800",
    ok: "bg-green-100 text-green-800",
    warn: "bg-yellow-100 text-yellow-800",
    danger: "bg-red-100 text-red-800",
    info: "bg-blue-100 text-blue-800",
  }[tone];
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{children}</span>;
}
function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 border flex flex-col">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

/** Page Controls */
export default function Controls() {
  const [tab, setTab] = useState("tasks"); // tasks | catalog | notpresent | attachments | library | history | analytics
  const [loading, setLoading] = useState(false);

  // Data
  const [tasks, setTasks] = useState([]);
  const [entities, setEntities] = useState([]);
  const [notPresent, setNotPresent] = useState([]);
  const [library, setLibrary] = useState({}); // { [type]: items[] }
  const [history, setHistory] = useState([]);

  // Filters (Tasks)
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fBuilding, setFBuilding] = useState("");
  const [fType, setFType] = useState("");

  // Selection
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetails, setTaskDetails] = useState(null);
  const [attachments, setAttachments] = useState([]);

  // Results
  const [resultForm, setResultForm] = useState({});
  const [aiRiskScore, setAiRiskScore] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState("");

  // DnD
  const dropRef = useRef(null);
  const [isDropping, setIsDropping] = useState(false);

  // ---------- LOAD ----------
  async function loadAll() {
    setLoading(true);
    try {
      const [t, e, n, lib, h] = await Promise.all([
        api.controls.listTasks({ q, status: fStatus, building: fBuilding, type: fType }),
        api.controls.listEntities(),
        api.controls.listNotPresent(),
        api.controls.library(),
        api.controls.history(),
      ]);
      setTasks(t.data || []);
      setEntities(e.data || []);
      setNotPresent(n || []);
      setLibrary(lib.library || {});
      setHistory(h || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fStatus, fBuilding, fType]);

  // ---------- SELECT TASK ----------
  async function handleSelectTask(id) {
    const d = await api.controls.getTask(id);
    setSelectedTask({ id: d.id, task_name: d.task_name, status: d.status, next_control: d.next_control });
    setTaskDetails(d);
    setResultForm(d.results || {});
    const atts = await api.controls.listAttachments(id);
    setAttachments(atts || []);
    setAiReply("");
    setTab("attachments");
  }

  // ---------- COMPLETE ----------
  async function handleCompleteTask() {
    if (!selectedTask) return;
    await api.controls.completeTask(selectedTask.id, {
      user: "current_user",
      results: resultForm,
      ai_risk_score: aiRiskScore,
    });
    setSelectedTask(null);
    setTaskDetails(null);
    setAttachments([]);
    await loadAll();
    setTab("tasks");
  }

  // ---------- ATTACHMENTS ----------
  async function handleUpload(files) {
    if (!selectedTask || !files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    await api.controls.uploadAttachment(selectedTask.id, fd);
    const atts = await api.controls.listAttachments(selectedTask.id);
    setAttachments(atts || []);
  }
  async function handleDeleteAttachment(attId) {
    if (!selectedTask) return;
    await api.controls.removeAttachment(selectedTask.id, attId);
    const atts = await api.controls.listAttachments(selectedTask.id);
    setAttachments(atts || []);
  }

  // ---------- DnD ----------
  useEffect(() => {
    const zone = dropRef.current;
    if (!zone) return;
    function prevent(e) { e.preventDefault(); e.stopPropagation(); }
    const onDragEnter = (e) => { prevent(e); setIsDropping(true); };
    const onDragOver  = (e) => { prevent(e); setIsDropping(true); };
    const onDragLeave = (e) => { prevent(e); setIsDropping(false); };
    const onDrop = async (e) => {
      prevent(e); setIsDropping(false);
      if (!selectedTask) return;
      const files = e.dataTransfer?.files;
      if (files?.length) await handleUpload(files);
    };
    zone.addEventListener("dragenter", onDragEnter);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    return () => {
      zone.removeEventListener("dragenter", onDragEnter);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, [selectedTask]);

  // ---------- AI ----------
  async function callAnalyze() {
    if (!selectedTask) return;
    setAiBusy(true);
    try {
      // Appelle l’endpoint IA qui lit directement les BLOBs côté serveur
      const res = await fetch(`/api/controls/tasks/${selectedTask.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Analyze failed");
      setAiReply(json.analysis || "");
      // (Option) recharger details si l’analyse remplit des champs
      // const d = await api.controls.getTask(selectedTask.id); setTaskDetails(d);
    } catch (e) {
      alert(e.message || "Analyze error");
    } finally {
      setAiBusy(false);
    }
  }
  async function callAssistant() {
    if (!selectedTask) return;
    setAiBusy(true);
    try {
      const question =
        taskDetails?.tsd_item
          ? `Avant contrôle: comment réaliser "${taskDetails.tsd_item.label}" sur ${selectedTask.task_name}?`
          : "Avant contrôle: comment réaliser le test ?";
      const res = await fetch(`/api/controls/tasks/${selectedTask.id}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question, lang: "fr" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Assistant failed");
      setAiReply(json.answer || "");
    } catch (e) {
      alert(e.message || "Assistant error");
    } finally {
      setAiBusy(false);
    }
  }

  // ---------- Analytics (client) ----------
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "Completed").length;
    const overdue = tasks.filter((t) => t.status === "Overdue").length;
    const planned = total - completed - overdue;
    const compliance = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, overdue, planned, compliance };
  }, [tasks]);

  // ---------- Buildings & types (issus du catalog) ----------
  const buildings = useMemo(() => {
    const set = new Set(entities.map((e) => e.building).filter(Boolean));
    return Array.from(set);
  }, [entities]);
  const types = useMemo(() => {
    const set = new Set(entities.map((e) => e.equipment_type).filter(Boolean));
    return Array.from(set);
  }, [entities]);

  return (
    <section className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Controls</h1>
          <div className="hidden sm:flex items-center gap-2">
            <Stat label="Total tasks" value={stats.total} />
            <Stat label="Completed" value={stats.completed} />
            <Stat label="Overdue" value={stats.overdue} />
            <Stat label="Compliance" value={`${stats.compliance}%`} />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Tab active={tab === "tasks"} onClick={() => setTab("tasks")}>Tasks</Tab>
        <Tab active={tab === "catalog"} onClick={() => setTab("catalog")}>Catalog</Tab>
        <Tab active={tab === "notpresent"} onClick={() => setTab("notpresent")}>Not Present</Tab>
        <Tab active={tab === "attachments"} onClick={() => setTab("attachments")}>Attachments</Tab>
        <Tab active={tab === "library"} onClick={() => setTab("library")}>TSD Library</Tab>
        <Tab active={tab === "history"} onClick={() => setTab("history")}>History</Tab>
        <Tab active={tab === "analytics"} onClick={() => setTab("analytics")}>Analytics</Tab>
      </div>

      {loading && <div className="py-8 text-center text-gray-500">Loading...</div>}

      {/* TASKS */}
      {!loading && tab === "tasks" && (
        <>
          {/* Filtres */}
          <Card className="mb-4">
            <CardBody className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-2 w-full md:w-1/2">
                <div className="relative w-full">
                  <Search size={16} className="absolute left-2 top-2.5 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search tasks…"
                    className="pl-7 pr-3 py-2 w-full rounded-md border border-gray-300"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="px-3 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Filter size={16} className="text-gray-500" />
                  <select className="border rounded-md px-2 py-1" value={fStatus} onChange={(e)=>setFStatus(e.target.value)}>
                    <option value="">Status</option>
                    <option>Planned</option>
                    <option>Completed</option>
                    <option>Overdue</option>
                  </select>
                  <select className="border rounded-md px-2 py-1" value={fBuilding} onChange={(e)=>setFBuilding(e.target.value)}>
                    <option value="">Building</option>
                    {buildings.map((b)=> <option key={b} value={b}>{b}</option>)}
                  </select>
                  <select className="border rounded-md px-2 py-1" value={fType} onChange={(e)=>setFType(e.target.value)}>
                    <option value="">Type</option>
                    {types.map((t)=> <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Liste */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((t) => (
              <Card key={t.id} className="hover:shadow-md transition cursor-pointer" onClick={() => handleSelectTask(t.id)}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">{t.task_name}</div>
                    <Badge
                      tone={t.status === "Overdue" ? "danger" : t.status === "Completed" ? "ok" : "info"}
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Next: {t.next_control || "—"}
                  </div>
                </CardBody>
              </Card>
            ))}
            {tasks.length === 0 && (
              <div className="text-gray-600">
                No tasks — Assure-toi que la **sync** a bien importé Switchboard/HV/ATEX et que la TSD a généré les contrôles.
              </div>
            )}
          </div>
        </>
      )}

      {/* CATALOG */}
      {!loading && tab === "catalog" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entities.map((e) => (
            <Card key={e.id}>
              <CardBody>
                <div className="font-medium">{e.name}</div>
                <div className="text-sm text-gray-600">{e.equipment_type} — {e.building}</div>
                {e.code && <div className="text-xs text-gray-500 mt-1">Code: {e.code}</div>}
              </CardBody>
            </Card>
          ))}
          {entities.length === 0 && <div className="text-gray-500">No equipment</div>}
        </div>
      )}

      {/* NOT PRESENT */}
      {!loading && tab === "notpresent" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notPresent.map((n) => (
            <Card key={n.id}>
              <CardBody>
                <div className="font-medium">{n.equipment_type}</div>
                <div className="text-sm text-gray-600">Building: {n.building}</div>
                {n.note && <div className="text-xs text-gray-500 mt-1">Note: {n.note}</div>}
              </CardBody>
            </Card>
          ))}
          {notPresent.length === 0 && <div className="text-gray-500">Nothing declared</div>}
        </div>
      )}

      {/* ATTACHMENTS */}
      {!loading && tab === "attachments" && (
        <Card>
          <CardBody>
            {!selectedTask ? (
              <div className="text-gray-500">Select a task in “Tasks” to manage its attachments.</div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="font-semibold">{selectedTask.task_name}</div>
                    <div className="text-sm text-gray-600">
                      {selectedTask.status} — Next: {selectedTask.next_control || "—"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer">
                      <Upload size={16} />
                      <span>Upload</span>
                      <input type="file" className="hidden" multiple onChange={(e) => handleUpload(e.target.files)} />
                    </label>
                    <button
                      type="button"
                      onClick={callAnalyze}
                      disabled={aiBusy || !attachments.length}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      title="Analyser automatiquement les PJ (extraction de valeurs, safety)"
                    >
                      <ImageDown size={16} /> Analyze
                    </button>
                    <button
                      type="button"
                      onClick={callAssistant}
                      disabled={aiBusy}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                      title="Assistant: comment réaliser le test ?"
                    >
                      <MessageSquareText size={16} /> Assistant
                    </button>
                  </div>
                </div>

                {/* Zone drag & drop */}
                <div
                  ref={dropRef}
                  className={`mt-4 border-2 border-dashed rounded-lg p-4 text-center ${
                    isDropping ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50"
                  }`}
                >
                  Glisser-déposer ici vos photos (IR, manomètre, etc.) ou documents (PDF, rapports…)
                </div>

                {/* Résultats & champs dynamiques */}
                {taskDetails?.tsd_item && (
                  <div className="mt-4 border rounded-lg p-3 bg-gray-50">
                    <div className="font-medium">{taskDetails.tsd_item.label}</div>
                    <div className="text-sm text-gray-600">Type: {taskDetails.tsd_item.type}</div>
                    <div className="text-sm mt-2 whitespace-pre-line">
                      {taskDetails.procedure_md || taskDetails.tsd_item.procedure_md}
                    </div>

                    {/* Champ dynamique */}
                    {taskDetails.tsd_item.type === "number" && (
                      <div className="mt-3">
                        <label className="block text-sm text-gray-700 mb-1">
                          {taskDetails.tsd_item.field} ({taskDetails.tsd_item.unit || "value"})
                        </label>
                        <input
                          type="number"
                          className="h-9 w-40 rounded-md border border-gray-300 px-2"
                          value={resultForm[taskDetails.tsd_item.field] || ""}
                          onChange={(e) =>
                            setResultForm({ ...resultForm, [taskDetails.tsd_item.field]: e.target.value })
                          }
                        />
                      </div>
                    )}
                    {taskDetails.tsd_item.type === "check" && (
                      <label className="mt-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!resultForm[taskDetails.tsd_item.field]}
                          onChange={(e) =>
                            setResultForm({ ...resultForm, [taskDetails.tsd_item.field]: e.target.checked })
                          }
                        />
                        <span className="text-sm">Marquer comme OK</span>
                      </label>
                    )}

                    {aiReply && (
                      <div className="mt-3 p-3 rounded-md bg-white border">
                        <div className="text-sm font-semibold mb-1">AI Suggestions</div>
                        <div className="text-sm whitespace-pre-line">{aiReply}</div>
                      </div>
                    )}

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={handleCompleteTask}
                        className="px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        Save Result
                      </button>
                    </div>
                  </div>
                )}

                {/* Liste des PJ */}
                <div className="mt-4">
                  <div className="font-medium mb-2">Attachments</div>
                  <ul className="divide-y">
                    {attachments.map((a) => (
                      <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                        <a
                          className="text-blue-600 underline break-all"
                          href={`/api/controls/tasks/${selectedTask.id}/attachments/${a.id}`}
                          download={a.filename}
                        >
                          {a.filename} ({Math.round(a.size / 1024)} kB)
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttachment(a.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Supprimer la pièce jointe"
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                    {attachments.length === 0 && <li className="py-2 text-gray-500">No files</li>}
                  </ul>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {/* LIBRARY */}
      {!loading && tab === "library" && (
        <div className="space-y-6">
          {Object.keys(library).length === 0 && <div className="text-gray-500">No library loaded</div>}
          {Object.entries(library).map(([type, items]) => (
            <Card key={type}>
              <CardBody>
                <div className="text-lg font-semibold mb-2">{type}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((it) => (
                    <div key={it.id} className="border rounded-lg p-2 bg-gray-50">
                      <div className="font-medium">{it.label}</div>
                      <div className="text-xs text-gray-600">
                        {it.type} {it.unit ? `(${it.unit})` : ""} • every {it.frequency_months} months
                      </div>
                      {it.procedure_md && (
                        <div className="text-xs text-gray-700 mt-1 whitespace-pre-line">{it.procedure_md}</div>
                      )}
                    </div>
                  ))}
                  {(!items || items.length === 0) && <div className="text-gray-500">No items</div>}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* HISTORY */}
      {!loading && tab === "history" && (
        <Card>
          <CardBody>
            <div className="text-sm text-gray-700 mb-2">Dernières opérations</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="py-2 px-2 text-left">Date</th>
                    <th className="py-2 px-2 text-left">Task</th>
                    <th className="py-2 px-2 text-left">User</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b">
                      <td className="py-2 px-2">{new Date(h.date).toLocaleString()}</td>
                      <td className="py-2 px-2">{h.task_name || `#${h.task_id}`}</td>
                      <td className="py-2 px-2">{h.user || "—"}</td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td className="py-4 px-2 text-gray-500" colSpan={3}>No history</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ANALYTICS */}
      {!loading && tab === "analytics" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total tasks" value={stats.total} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="Overdue" value={stats.overdue} />
          <Stat label="Planned" value={stats.planned} />
          <Stat label="Compliance" value={`${stats.compliance}%`} />
        </div>
      )}
    </section>
  );
}
