
/**
 * Controls.jsx — Frontend complet pour le module Controls
 * - Liste + filtres (status par défaut = "all")
 * - Seed (dry-run & création), Import d'entités
 * - Détails d'une tâche avec :
 *    - Récupération du schéma (/tasks/:id/schema) et rendu checklist + observations
 *    - IA "avant intervention" (upload image -> /ai/analyze-before) => consignes
 *    - IA "pendant" (upload image + hint -> /ai/read-measure) => valeur extraite
 *    - Historique de la tâche
 *    - Clôture (PATCH /tasks/:id/close)
 * - Gantt (gantt-task-react)
 *
 * NPM requis côté front :
 *   npm i dayjs gantt-task-react uuid
 */

import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

const API_BASE = "/api/controls";

// ----------------------------- helpers ---------------------------------
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
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
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ----------------------------- API -------------------------------------
const API = {
  tasks: (params = {}) => fetchJSON(`${API_BASE}/tasks${toQS(params)}`),
  calendar: (params = {}) => fetchJSON(`${API_BASE}/calendar${toQS(params)}`),
  history: (id) => fetchJSON(`${API_BASE}/tasks/${id}/history`),
  schema: (id) => fetchJSON(`${API_BASE}/tasks/${id}/schema`),
  close: (id, payload) => fetchJSON(`${API_BASE}/tasks/${id}/close`, { method: "PATCH", body: JSON.stringify(payload) }),
  analyzeBefore: (payload) => fetchJSON(`${API_BASE}/ai/analyze-before`, { method: "POST", body: JSON.stringify(payload) }),
  readMeasure: (payload) => fetchJSON(`${API_BASE}/ai/read-measure`, { method: "POST", body: JSON.stringify(payload) }),
  seed: (params = {}) => fetchJSON(`${API_BASE}/bootstrap/seed${toQS(params)}`),
  importEntities: (payload = {}) => fetchJSON(`${API_BASE}/bootstrap/import-entities`, { method: "POST", body: JSON.stringify(payload) }),
};

// ----------------------------- UI atoms --------------------------------
function Button({ children, onClick, disabled, kind = "primary" }) {
  const styles = {
    primary: "background:#2563eb;color:white;border:none",
    secondary: "background:#6b7280;color:white;border:none",
    success: "background:#16a34a;color:white;border:none",
    warn: "background:#d97706;color:white;border:none",
    danger: "background:#dc2626;color:white;border:none",
    ghost: "background:white;color:#111827;border:1px solid #d1d5db",
  }[kind];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", opacity: disabled ? 0.6 : 1, ...styleFrom(styles) }}
    >
      {children}
    </button>
  );
}
function styleFrom(css) {
  const s = {};
  css.split(";").forEach((d) => {
    const [k, v] = d.split(":").map((x) => x && x.trim());
    if (!k || !v) return;
    const jsKey = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    s[jsKey] = v;
  });
  return s;
}
function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db", width: "100%" }}
    />
  );
}
function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db", width: "100%" }}
    >
      <option value="">{placeholder || "Select..."}</option>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}
function Badge({ color = "#1f2937", bg = "#e5e7eb", children }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 999,
        color,
        background: bg,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
function Modal({ open, onClose, title, children, width = 820 }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ width, maxWidth: "95vw", maxHeight: "92vh", overflow: "auto", background: "white", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

// ----------------------------- Main ------------------------------------
export default function Controls() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState({ status: "all", search: "" });
  const [selected, setSelected] = useState(null);

  const [calendar, setCalendar] = useState([]);
  const [viewMode, setViewMode] = useState(ViewMode.Month);

  const [seedLog, setSeedLog] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState(null);
  const [importSource, setImportSource] = useState("ALL");

  async function loadTasks() {
    setError(""); setLoading(true);
    try {
      const params = {};
      if (filter.status && filter.status !== "all") params.status = filter.status;
      if (filter.search) params.q = filter.search;
      const data = await API.tasks(params);
      setTasks(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      console.error(e);
      setTasks([]);
      setError(e.message || "Erreur lors du chargement des tâches");
    } finally { setLoading(false); }
  }

  async function loadCalendar() {
    try {
      const data = await API.calendar({});
      const tasksGantt = Object.values(data).flat().filter((t)=>t && t.id && t.label && t.due_date).map((t)=>{
        const start = new Date(t.due_date);
        const end   = new Date(dayjs(t.due_date).add(1, "day").toISOString());
        return { id: String(t.id), name: t.label, start, end, type: "task", progress: t.status === "Done" ? 100 : 0 };
      });
      setCalendar(tasksGantt);
    } catch (e) {
      console.error(e);
      setCalendar([]);
    }
  }

  async function doSeed(dryRun=true, category="ALL") {
    setSeeding(true); setSeedLog(null); setError("");
    try {
      const resp = await API.seed({ dry_run: dryRun ? 1 : 0, category });
      setSeedLog(resp);
      if (!dryRun) {
        await loadTasks();
        await loadCalendar();
      }
    } catch (e) {
      setError(e.message || "Erreur lors du seed");
    } finally { setSeeding(false); }
  }

  async function doImportEntities() {
    setImporting(true); setImportLog(null); setError("");
    try {
      const resp = await API.importEntities({ source: importSource, site: "Default", limit: 200 });
      setImportLog(resp);
    } catch (e) {
      setError(e.message || "Erreur lors de l'import d'entités");
    } finally { setImporting(false); }
  }

  useEffect(() => { loadTasks(); loadCalendar(); }, [JSON.stringify(filter)]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Controls</h1>

      {/* Bandeau confort */}
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>Base vide ? Importe des entités puis crée les tâches TSD.</span>
        <Select
          value={importSource}
          onChange={setImportSource}
          options={[
            { value: "ALL", label: "ALL (switchboards/devices/hv/atex)" },
            { value: "switchboards", label: "Switchboards" },
            { value: "devices", label: "Devices" },
            { value: "hv_equipments", label: "HV Equipments" },
            { value: "atex_equipments", label: "ATEX Equipments" },
          ]}
          placeholder="Source"
        />
        <Button kind="secondary" disabled={importing} onClick={doImportEntities}>
          {importing ? "Import..." : "Importer des entités"}
        </Button>
        {importLog && <span style={{ fontSize: 12, color: "#6b7280" }}>
          {importLog.ok ? `Créées: ${importLog.created_count}` : "—"}
        </span>}

        <Button kind="warn" disabled={seeding} onClick={() => doSeed(true, "ALL")}>
          {seeding ? "Dry-run..." : "Simuler seed (ALL)"}
        </Button>
        <Button kind="success" disabled={seeding} onClick={() => doSeed(false, "ALL")}>
          {seeding ? "Création..." : "Créer tâches (ALL)"}
        </Button>
        {seedLog && <span style={{ fontSize: 12, color: "#6b7280" }}>
          {seedLog.ok ? `Entités: ${seedLog.count_entities} • actions: ${seedLog.actions?.length || 0}` : "—"}
        </span>}
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ width: 280 }}>
          <Input value={filter.search} onChange={(v)=>setFilter({ ...filter, search: v })} placeholder="Recherche..." />
        </div>
        <div style={{ width: 180 }}>
          <Select
            value={filter.status}
            onChange={(v)=>setFilter({ ...filter, status: v })}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "overdue", label: "Overdue" },
              { value: "all", label: "All" },
            ]}
            placeholder="Status"
          />
        </div>
        <Button kind="primary" onClick={loadTasks}>Actualiser</Button>
        {error && <span style={{ color: "#dc2626" }}>{error}</span>}
      </div>

      {/* Tableau */}
      <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Label</th>
              <th style={{ textAlign: "left", padding: 8 }}>Type</th>
              <th style={{ textAlign: "left", padding: 8 }}>Status</th>
              <th style={{ textAlign: "left", padding: 8 }}>Due Date</th>
              <th style={{ textAlign: "left", padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: 8 }}>{t.label}</td>
                <td style={{ padding: 8 }}>{t.task_code || t.control_type}</td>
                <td style={{ padding: 8 }}>
                  {["Planned","Pending","Overdue"].includes(t.status) && <Badge color="#1d4ed8" bg="#dbeafe">Open</Badge>}
                  {t.status === "Done" && <Badge color="#15803d" bg="#dcfce7">Closed</Badge>}
                </td>
                <td style={{ padding: 8 }}>{t.due_date ? dayjs(t.due_date).format("DD/MM/YYYY") : "-"}</td>
                <td style={{ padding: 8 }}>
                  <Button kind="ghost" onClick={() => setSelected(t)}>Détails</Button>
                </td>
              </tr>
            ))}
            {(!tasks || tasks.length === 0) && (
              <tr><td colSpan={5} style={{ padding: 12, color: "#6b7280" }}>Aucune tâche.</td></tr>
            )}
          </tbody>
        </table>
        {loading && <div style={{ padding: 8, color: "#6b7280" }}>Chargement…</div>}
      </div>

      {/* Gantt */}
      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, background: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Calendrier (Gantt)</h3>
          <select
            value={Object.keys(ViewMode).find(k => ViewMode[k] === viewMode) || "Month"}
            onChange={(e)=>setViewMode({Week:ViewMode.Week,Month:ViewMode.Month,Year:ViewMode.Year}[e.target.value] || ViewMode.Month)}
            style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db" }}
          >
            <option value="Week">Week</option>
            <option value="Month">Month</option>
            <option value="Year">Year</option>
          </select>
        </div>
        <div style={{ height: 420, overflowX: "auto", background: "white" }}>
          {Array.isArray(calendar) && calendar.length > 0 ? (
            <Gantt tasks={calendar} viewMode={viewMode} />
          ) : (
            <div style={{ padding: 8, color: "#6b7280" }}>Aucune tâche à afficher dans le calendrier.</div>
          )}
        </div>
      </div>

      <Modal open={!!selected} onClose={()=>setSelected(null)} title={selected ? selected.label : ""}>
        {selected && <TaskDetails task={selected} onClose={()=>setSelected(null)} onReload={async()=>{ await loadTasks(); await loadCalendar(); }} />}
      </Modal>
    </div>
  );
}

// ------------------------ Task Details modal ----------------------------
function TaskDetails({ task, onClose, onReload }) {
  const [schema, setSchema] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // UI state for checklist/observations
  const [checkSel, setCheckSel] = useState({}); // key -> "Conforme"/...
  const [observations, setObservations] = useState({}); // dynamic fields

  // IA Before
  const [beforeFindings, setBeforeFindings] = useState([]);
  const [beforeUploading, setBeforeUploading] = useState(false);

  // IA During
  const [duringParsed, setDuringParsed] = useState(null);
  const [duringUploading, setDuringUploading] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const [s, h] = await Promise.all([API.schema(task.id), API.history(task.id)]);
        if (!isMounted) return;
        setSchema(s);
        setHistory(Array.isArray(h) ? h : []);

        // init selections
        const initChecks = {};
        (s?.checklist || []).forEach(item => { initChecks[item.key] = initChecks[item.key] || ""; });
        setCheckSel(initChecks);

        const initObs = {};
        (s?.observations || []).forEach(o => { initObs[o.key] = ""; });
        setObservations(initObs);
      } catch (e) {
        console.error(e);
        setError(e.message || "Erreur chargement schéma / historique");
      } finally { setLoading(false); }
    })();
    return () => { isMounted = false; };
  }, [task.id]);

  function setCheck(key, val) { setCheckSel((prev) => ({ ...prev, [key]: val })); }
  function setObs(key, val) { setObservations((prev) => ({ ...prev, [key]: val })); }

  async function closeTask() {
    try {
      const checklistArr = Object.entries(checkSel).map(([k, v]) => ({ key: k, value: v }));
      await API.close(task.id, {
        record_status: "done",
        checklist: checklistArr,
        observations,
        attachments: [],
        comment: observations?.notes || ""
      });
      await onReload();
      onClose();
    } catch (e) {
      alert(e.message || "Erreur lors de la clôture");
    }
  }

  async function uploadBefore(file) {
    if (!file) return;
    setBeforeUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const data = await API.analyzeBefore({ task_id: task.id, image_base64: base64 });
      setBeforeFindings(data.findings || []);
    } catch (e) {
      alert(e.message || "Erreur analyse avant intervention");
    } finally { setBeforeUploading(false); }
  }

  async function uploadDuring(file) {
    if (!file) return;
    setDuringUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const data = await API.readMeasure({ task_id: task.id, image_base64: base64, hint });
      setDuringParsed(data);
      // si une valeur numérique est trouvée, propose de la ranger dans observations
      if (data && typeof data.parsed_value === "number") {
        const k = (schema?.observations || []).find(o => /value|reading|mesure|measurement/i.test(o.key || ""))?.key || "measurement_value";
        setObservations(prev => ({ ...prev, [k]: String(data.parsed_value) }));
      }
    } catch (e) {
      alert(e.message || "Erreur lecture mesure");
    } finally { setDuringUploading(false); }
  }

  const options = useMemo(() => new Set([
    "Conforme","Non conforme","Non applicable","OK","NOK","NA"
  ]), []);

  return (
    <div>
      {loading && <div style={{ color: "#6b7280" }}>Chargement…</div>}
      {error && <div style={{ color: "#dc2626" }}>{error}</div>}

      {!loading && schema && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Checklist */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>Checklist</h4>
            {schema.checklist && schema.checklist.length > 0 ? (
              <table style={{ width: "100%", fontSize: 14 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Point</th><th style={{ textAlign: "left" }}>Résultat</th></tr></thead>
                <tbody>
                  {schema.checklist.map((item) => (
                    <tr key={item.key}>
                      <td style={{ padding: "6px 4px" }}>{item.label}</td>
                      <td style={{ padding: "6px 4px" }}>
                        <Select
                          value={checkSel[item.key] || ""}
                          onChange={(v)=>setCheck(item.key, v)}
                          options={(item.options && item.options.length ? item.options : Array.from(options)).map(o=>({ value:o, label:o }))}
                          placeholder="Sélectionner"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: "#6b7280" }}>Pas de checklist pour ce contrôle.</div>
            )}
          </div>

          {/* Observations */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>Observations</h4>
            {schema.observations && schema.observations.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {schema.observations.map((o) => (
                  <div key={o.key} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, alignItems: "center" }}>
                    <label style={{ fontSize: 13, color: "#374151" }}>{o.label || o.key}</label>
                    {o.type === "number" ? (
                      <Input type="number" value={observations[o.key] || ""} onChange={(v)=>setObs(o.key, v)} placeholder="0.00" />
                    ) : (
                      <Input value={observations[o.key] || ""} onChange={(v)=>setObs(o.key, v)} placeholder="..." />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#6b7280" }}>Pas de champs d'observation.</div>
            )}
          </div>

          {/* IA Before */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>Analyse avant intervention</h4>
            <input type="file" accept="image/*" onChange={(e)=>uploadBefore(e.target.files?.[0])} />
            {beforeUploading && <div style={{ color: "#6b7280" }}>Analyse en cours…</div>}
            {beforeFindings && beforeFindings.length > 0 && (
              <ul>
                {beforeFindings.map((f, i) => (
                  <li key={i} style={{ margin: "4px 0" }}>
                    <Badge bg="#eef2ff" color="#3730a3">{f.type}</Badge> {f.message} <span style={{ color: "#6b7280" }}>({Math.round((f.confidence||0)*100)}%)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* IA During */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>Lecture pendant intervention</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 8, alignItems: "center" }}>
              <Input value={hint} onChange={setHint} placeholder="Indice (ex: 231.5)" />
              <input type="file" accept="image/*" onChange={(e)=>uploadDuring(e.target.files?.[0])} />
            </div>
            {duringUploading && <div style={{ color: "#6b7280" }}>Analyse en cours…</div>}
            {duringParsed && (
              <div style={{ marginTop: 8, fontSize: 14 }}>
                Valeur extraite : <b>{duringParsed.parsed_value ?? "—"}</b> {duringParsed.unit || ""}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historique + actions */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0 }}>Historique</h4>
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="success" onClick={closeTask}>Clôturer la tâche</Button>
          <Button kind="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </div>
      <div style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 220, overflow: "auto" }}>
        <table style={{ width: "100%", fontSize: 13 }}>
          <thead style={{ background: "#f9fafb" }}><tr><th style={{ textAlign: "left", padding: 6 }}>Date</th><th style={{ textAlign: "left", padding: 6 }}>Action</th><th style={{ textAlign: "left", padding: 6 }}>Par</th></tr></thead>
          <tbody>
            {history.map((h, idx) => (
              <tr key={idx} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: 6 }}>{h.date ? dayjs(h.date).format("DD/MM/YYYY HH:mm") : "-"}</td>
                <td style={{ padding: 6 }}>{h.action} — {h.task_name}</td>
                <td style={{ padding: 6 }}>{h.user || "-"}</td>
              </tr>
            ))}
            {(!history || history.length === 0) && (
              <tr><td colSpan={3} style={{ padding: 8, color: "#6b7280" }}>Aucun historique.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
