import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "../lib/api.js";
import { RefreshCcw, X, Upload, Search, Filter, ImageDown, MessageSquare, ChevronRight, ChevronDown } from "lucide-react";

// Utilitaires fetch simples
const API = {
  tree: async () => (await fetch(`/api/controls/tree`)).json(),
  tasksByEntity: async (entityId, q = "") => {
    const url = new URL(`/api/controls/tasks`, window.location.origin);
    url.searchParams.set("entity_id", entityId);
    if (q) url.searchParams.set("q", q);
    const r = await fetch(url);
    return r.json();
  },
  taskDetails: async (id) => (await fetch(`/api/controls/tasks/${id}/details`)).json(),
  listAttachments: async (taskId) => (await fetch(`/api/controls/tasks/${taskId}/attachments`)).json(),
  upload: async (taskId, files, label) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    // label stocké côté DB si tu as ajouté la colonne ; sinon ignoré
    if (label) fd.append("label", label);
    const r = await fetch(`/api/controls/tasks/${taskId}/upload`, { method: "POST", body: fd });
    return r.json();
  },
  analyze: async (taskId) => (await fetch(`/api/controls/tasks/${taskId}/analyze`, { method: "POST" })).json(),
  assistant: async (taskId, question) =>
    (await fetch(`/api/controls/tasks/${taskId}/assistant`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) })).json(),
  complete: async (taskId, payload) =>
    (await fetch(`/api/controls/tasks/${taskId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).json()
};

// Mini UI primitives
function Button({ children, onClick, kind = "solid", disabled, style }) {
  const base = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: kind === "solid" ? "#111827" : "#fff",
    color: kind === "solid" ? "#fff" : "#111827",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14
  };
  return (
    <button disabled={disabled} onClick={onClick} style={{ ...base, ...style }}>
      {children}
    </button>
  );
}

function Pill({ children, color = "#e5e7eb" }) {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, background: color, fontSize: 12 }}>{children}</span>
  );
}

function Section({ title, right, children, style }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff", ...style }}>
      <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div>{right}</div>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

// Helpers affichage
function fmtNext(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString();
}
function StatusPill({ status }) {
  if (status === "Overdue") return <Pill color="#fee2e2">Overdue</Pill>;
  if (status === "Completed") return <Pill color="#dcfce7">Completed</Pill>;
  return <Pill>Planned</Pill>;
}

// Drag & Drop
function DropArea({ onFiles }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDragOver = (e) => { e.preventDefault(); setOver(true); };
    const onDragLeave = () => setOver(false);
    const onDrop = (e) => {
      e.preventDefault(); setOver(false);
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) onFiles(files);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  return (
    <div ref={ref} style={{
      border: "2px dashed #d1d5db",
      borderRadius: 10,
      padding: 16,
      textAlign: "center",
      background: over ? "#f9fafb" : "transparent"
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", color: "#6b7280" }}>
        <Upload size={16} /> Déposez vos photos/docs ici (ou cliquez)
      </div>
      <input
        type="file"
        multiple
        onChange={(e) => onFiles([...e.target.files])}
        style={{ marginTop: 8, width: "100%" }}
      />
    </div>
  );
}

export default function Controls() {
  const [tree, setTree] = useState([]);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [entityTasks, setEntityTasks] = useState([]);
  const [qTask, setQTask] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetails, setTaskDetails] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [assistantQ, setAssistantQ] = useState("Comment réaliser le test ?");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [answer, setAnswer] = useState("");

  // Charger l’arborescence
  useEffect(() => {
    API.tree().then(setTree).catch(console.error);
  }, []);

  // Quand un équipement est choisi → tasks
  useEffect(() => {
    if (!selectedEntity) return;
    API.tasksByEntity(selectedEntity.id, qTask).then((r) => setEntityTasks(r.data || [])).catch(console.error);
  }, [selectedEntity, qTask]);

  // Détails + PJ quand une task est choisie
  useEffect(() => {
    if (!selectedTask) { setTaskDetails(null); setAttachments([]); setAnswer(""); return; }
    API.taskDetails(selectedTask.id).then(setTaskDetails).catch(console.error);
    API.listAttachments(selectedTask.id).then(setAttachments).catch(console.error);
  }, [selectedTask]);

  // UI checklist depuis TSD / result_schema
  const [form, setForm] = useState({});
  useEffect(() => {
    if (!taskDetails) return;
    // Construire un modèle de formulaire
    const rs = taskDetails.result_schema || {};
    const item = taskDetails.tsd_item || {};
    const field = rs.field || item.field || "value";
    const type = rs.type || item.type || "boolean"; // boolean | number | text | select
    const unit = rs.unit || item.unit || "";
    const options = item.options || rs.options || null;
    setForm({
      field, type, unit, options,
      value: (taskDetails.results && taskDetails.results[field]) || (type === "boolean" ? false : "")
    });
  }, [taskDetails]);

  const updateValue = (val) => setForm((f) => ({ ...f, value: val }));

  // Actions
  const onUpload = async (files) => {
    if (!selectedTask) return;
    await API.upload(selectedTask.id, files);
    const list = await API.listAttachments(selectedTask.id);
    setAttachments(list);
  };

  const onAnalyze = async () => {
    if (!selectedTask) return;
    setAnalyzing(true);
    try {
      const r = await API.analyze(selectedTask.id);
      setAnswer(r.analysis || "—");
      // refresh details (ai_notes…)
      const det = await API.taskDetails(selectedTask.id);
      setTaskDetails(det);
    } finally {
      setAnalyzing(false);
    }
  };

  const onAsk = async () => {
    if (!selectedTask) return;
    const r = await API.assistant(selectedTask.id, assistantQ);
    setAnswer(r.answer || "—");
  };

  const onComplete = async () => {
    if (!selectedTask || !form) return;
    setSaving(true);
    try {
      const payload = { user: "tech", results: { [form.field]: form.value } };
      await API.complete(selectedTask.id, payload);
      // refresh tasks + details
      const r = await API.tasksByEntity(selectedEntity.id, qTask);
      setEntityTasks(r.data || []);
      const det = await API.taskDetails(selectedTask.id);
      setTaskDetails(det);
    } finally {
      setSaving(false);
    }
  };

  // Layout 3 colonnes responsive
  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 420px", gap: 12, padding: 12, maxWidth: 1600, margin: "0 auto" }}>
      {/* COL 1 : Tree */}
      <Section
        title="Catalogue"
        right={<Button kind="ghost" onClick={() => API.tree().then(setTree)}><RefreshCcw size={16} /></Button>}
        style={{ minHeight: 600 }}
      >
        {tree.length === 0 ? (
          <div style={{ color: "#6b7280" }}>Aucun équipement. Lance la sync, ou vérifie les services HV/ATEX/Switchboard.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tree.map((b) => (
              <BuildingNode key={b.building} node={b} onSelectEntity={setSelectedEntity} selectedId={selectedEntity?.id} />
            ))}
          </div>
        )}
      </Section>

      {/* COL 2 : Tasks de l’équipement */}
      <Section
        title={`Tasks ${selectedEntity ? `• ${selectedEntity.name}` : ""}`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <Search size={16} style={{ marginRight: 6 }} />
              <input placeholder="Search…" value={qTask} onChange={(e) => setQTask(e.target.value)} style={{ border: 0, outline: 0 }} />
            </div>
          </div>
        }
        style={{ minHeight: 600 }}
      >
        {!selectedEntity ? (
          <div style={{ color: "#6b7280" }}>Choisis un équipement dans le catalogue.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entityTasks.length === 0 ? (
              <div style={{ color: "#6b7280" }}>Aucune tâche pour cet équipement.</div>
            ) : entityTasks.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelectedTask(t)}
                style={{
                  border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, cursor: "pointer",
                  background: selectedTask?.id === t.id ? "#f9fafb" : "#fff", display: "flex", justifyContent: "space-between", alignItems: "center"
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{t.task_name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Next: {fmtNext(t.next_control)}</div>
                </div>
                <StatusPill status={t.status} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* COL 3 : Détail / Checklist / PJ / IA */}
      <Section
        title="Détail & Contrôle"
        right={selectedTask ? <Pill>Task #{selectedTask.id}</Pill> : null}
        style={{ minHeight: 600 }}
      >
        {!selectedTask || !taskDetails ? (
          <div style={{ color: "#6B7280" }}>Sélectionne une task pour remplir la checklist, ajouter des photos et lancer l’IA.</div>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{taskDetails.task_name}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusPill status={taskDetails.status} />
                <span style={{ fontSize: 12, color: "#6b7280" }}>Code: {taskDetails.task_code}</span>
              </div>
            </div>

            {/* Checklist */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Checklist</div>
              <Checklist form={form} onChange={updateValue} />
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <Button onClick={onComplete} disabled={saving}>
                  {saving ? "Saving…" : "Complete"}
                </Button>
              </div>
            </div>

            {/* Pièces jointes */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Pièces jointes</div>
              <DropArea onFiles={onUpload} />
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {attachments.map((a) => (
                  <a key={a.id} href={`/api/controls/tasks/${taskDetails.id}/attachments/${a.id}`} target="_blank" style={{
                    border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, display: "flex", gap: 8, textDecoration: "none", color: "#111827"
                  }}>
                    <ImageDown size={16} />
                    <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                Astuce : dépose une photo “safety” avant intervention pour que l’IA propose les actions de prévention. Dépose aussi les relevés (thermo, IR, mesures…).
              </div>
            </div>

            {/* IA */}
            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <Button kind="ghost" onClick={onAnalyze} disabled={analyzing}>
                  {analyzing ? "Analyzing…" : <>Analyze IA</>}
                </Button>
                <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 8, flex: 1 }}>
                  <MessageSquare size={16} style={{ marginRight: 6 }} />
                  <input value={assistantQ} onChange={(e) => setAssistantQ(e.target.value)} placeholder="Pose ta question…" style={{ border: 0, outline: 0, width: "100%" }} />
                </div>
                <Button onClick={onAsk}>Assistant</Button>
              </div>
              {answer && (
                <div style={{ whiteSpace: "pre-wrap", fontSize: 14, background: "#f9fafb", border: "1px solid #eef2f7", padding: 10, borderRadius: 8 }}>
                  {answer}
                </div>
              )}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

// === Composants auxiliaires ===

function BuildingNode({ node, onSelectEntity, selectedId }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>Building {node.building}</strong>
      </div>
      {open && (
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {node.groups.map((g) => (
            <GroupNode key={g.type} group={g} onSelectEntity={onSelectEntity} selectedId={selectedId} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupNode({ group, onSelectEntity, selectedId }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#374151", fontWeight: 600 }} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {group.label} <span style={{ fontWeight: 400, color: "#6b7280" }}>({group.entities.length})</span>
      </div>
      {open && (
        <div style={{ marginLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {group.entities.map((e) => (
            <EntityRow key={e.id} e={e} onSelect={() => onSelectEntity(e)} selected={selectedId === e.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntityRow({ e, onSelect, selected }) {
  const overdue = Number(e.counts?.overdue || 0);
  const planned = Number(e.counts?.planned || 0);
  const completed = Number(e.counts?.completed || 0);
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        background: selected ? "#eef2ff" : "transparent",
        cursor: "pointer",
        display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between"
      }}
      title={e.code || ""}
    >
      <span>{e.name}</span>
      <span style={{ display: "flex", gap: 4 }}>
        {overdue > 0 && <Pill color="#fee2e2">OD {overdue}</Pill>}
        {planned > 0 && <Pill>PL {planned}</Pill>}
        {completed > 0 && <Pill color="#dcfce7">OK {completed}</Pill>}
      </span>
    </div>
  );
}

function Checklist({ form, onChange }) {
  if (!form) return null;
  const label = `${form.field}${form.unit ? ` (${form.unit})` : ""}`;
  if (form.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={!!form.value} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (form.type === "number") {
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span>{label}</span>
        <input type="number" value={form.value} onChange={(e) => onChange(Number(e.target.value))} style={{ padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }} />
      </label>
    );
  }
  if (form.type === "select" && Array.isArray(form.options)) {
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span>{label}</span>
        <select value={form.value} onChange={(e) => onChange(e.target.value)} style={{ padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}>
          <option value="">—</option>
          {form.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span>{label}</span>
      <input type="text" value={form.value} onChange={(e) => onChange(e.target.value)} style={{ padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }} />
    </label>
  );
}
