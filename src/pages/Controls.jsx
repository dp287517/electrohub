// src/pages/Controls.jsx
import { useEffect, useState } from "react";
import { get } from "../lib/api.js"; // facultatif si tu veux encore des appels bruts
import { api } from "../lib/api.js";
import { RefreshCcw, X, Upload } from "lucide-react";

/* ---------- Mini UI sans shadcn ---------- */
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

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
        <div className="px-4 py-3 border-t bg-gray-50 flex justify-end">{footer}</div>
      </div>
    </div>
  );
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

/* ---------- Page Controls ---------- */
export default function Controls() {
  const [tab, setTab] = useState("tasks"); // tasks | catalog | notpresent | attachments | library | history | analytics
  const [loading, setLoading] = useState(false);

  // Données
  const [tasks, setTasks] = useState([]);
  const [entities, setEntities] = useState([]);
  const [notPresent, setNotPresent] = useState([]);
  const [library, setLibrary] = useState({}); // { [type]: items[] }

  // Sélection courante
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetails, setTaskDetails] = useState(null);
  const [attachments, setAttachments] = useState([]);

  // Form résultats
  const [resultForm, setResultForm] = useState({});
  const [aiRiskScore, setAiRiskScore] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [t, e, n, lib] = await Promise.all([
        api.controls.listTasks(),
        api.controls.listEntities(),
        api.controls.listNotPresent(),
        api.controls.library(),
      ]);
      setTasks(t.data || []);
      setEntities(e.data || []);
      setNotPresent(n || []);
      setLibrary(lib.library || {});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSelectTask(id) {
    const d = await api.controls.getTask(id);
    setSelectedTask({ id: d.id, task_name: d.task_name, status: d.status, next_control: d.next_control });
    setTaskDetails(d);
    setResultForm(d.results || {});
    const atts = await api.controls.listAttachments(id);
    setAttachments(atts || []);
    setTab("attachments"); // va direct sur pj pour accélérer la saisie
  }

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
  }

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

  async function analyzePhotos() {
    if (!selectedTask || !attachments.length) return;
    setAiBusy(true);
    try {
      const fd = new FormData();
      // On ne re-upload pas les binaires, l’endpoint vision accepte des files => ici, on passe sans,
      // mais tu peux aussi réuploader depuis l’input si tu veux un score live avant sauvegarde.
      // Pour une UX simple, propose un nouvel input juste pour l’analyse si besoin.
      // Ici, on prend un “fast path” : pas d’envoi = pas d’analyse.
      // Si tu veux vraiment analyser les PJ déjà en BDD, crée un endpoint backend dédié (server_controls) qui lit les BLOBs.
      alert("Pour analyser automatiquement les PJ déjà uploadées, ajoute un endpoint backend (ex: /ai/vision-score-from-db).");
    } finally {
      setAiBusy(false);
    }
  }

  async function getAIAssistant() {
    if (!selectedTask) return;
    setAiBusy(true);
    try {
      const res = await api.controls.assistant({ mode: "text", text: "Conseils de maintenance sur cette tâche", lang: "fr" });
      setAiReply(res.reply || "");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <section className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Controls</h1>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>

      {/* Onglets */}
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
                <div className="text-sm text-gray-600 mt-1">Next: {t.next_control || "—"}</div>
              </CardBody>
            </Card>
          ))}
          {tasks.length === 0 && <div className="text-gray-500">No tasks</div>}
        </div>
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
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer">
                    <Upload size={16} />
                    <span>Upload</span>
                    <input type="file" className="hidden" multiple onChange={(e) => handleUpload(e.target.files)} />
                  </label>
                </div>

                {/* Résultats & IA */}
                {taskDetails?.tsd_item && (
                  <div className="mt-4 border rounded-lg p-3 bg-gray-50">
                    <div className="font-medium">{taskDetails.tsd_item.label}</div>
                    <div className="text-sm text-gray-600">Type: {taskDetails.tsd_item.type}</div>
                    <div className="text-sm mt-2">{taskDetails.procedure_md || taskDetails.tsd_item.procedure_md}</div>

                    {/* Champ dynamique simple */}
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

                    <div className="mt-3 flex items-center gap-3">
                      <label className="text-sm">AI Risk Score</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        className="h-9 w-24 rounded-md border border-gray-300 px-2"
                        value={aiRiskScore ?? ""}
                        onChange={(e) => setAiRiskScore(e.target.value === "" ? null : Number(e.target.value))}
                      />
                      <button
                        type="button"
                        onClick={analyzePhotos}
                        disabled={aiBusy || !attachments.length}
                        className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {aiBusy ? "Analyzing..." : "Analyze Photos"}
                      </button>
                      <button
                        type="button"
                        onClick={getAIAssistant}
                        disabled={aiBusy}
                        className="px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                      >
                        {aiBusy ? "Thinking..." : "AI Advice"}
                      </button>
                    </div>

                    {aiReply && <div className="mt-2 text-sm text-gray-800">{aiReply}</div>}

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
                      <li key={a.id} className="py-2 flex items-center justify-between">
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
        <div className="text-gray-500">TODO: brancher api.controls.history() et afficher les résultats</div>
      )}

      {/* ANALYTICS */}
      {!loading && tab === "analytics" && (
        <div className="text-gray-500">TODO: indicateurs (total/completed/open/overdue, taux compliance, etc.)</div>
      )}
    </section>
  );
}
