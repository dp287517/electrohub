import React, { useEffect, useMemo, useRef, useState } from "react";

/* =====================================
   Helpers (robustes contre valeurs brutes)
===================================== */
function cls(...a) { return a.filter(Boolean).join(" "); }
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtDT = (s) => (s ? new Date(s).toLocaleString() : "—");

function isPlainObject(x){ return x && typeof x === 'object' && !Array.isArray(x); }
function toLabel(x, fallback = "—") {
  if (x == null) return fallback;
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return String(x);
  if (isPlainObject(x)) return x.label || x.name || x.title || x.value || fallback;
  return fallback;
}
function toValue(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return x;
  if (isPlainObject(x)) return x.value ?? x.key ?? x.id ?? toLabel(x, "");
  return "";
}
function SafeText({ value, empty = "—" }) {
  const v = value;
  if (v == null || v === "") return <>{empty}</>;
  if (typeof v === "string" || typeof v === "number") return <>{String(v)}</>;
  if (typeof v === "boolean") return <>{v ? "Oui" : "Non"}</>;
  // Évite l'erreur React #31: on ne rend JAMAIS d'objet brut
  if (Array.isArray(v)) return <>{v.map((it, i) => toLabel(it)).filter(Boolean).join(" · ")}</>;
  if (isPlainObject(v)) return <>{toLabel(v, empty)}</>;
  return <>{empty}</>;
}

/* ============================
   API utils (mise à jour)
============================ */
function headersFor(site) { return site ? { "X-Site": site } : {}; }
const CONTROLS_API = {
  library: () => fetchJSON(`/api/controls/library`),
  tree: (site) => fetchJSON(`/api/controls/tree`, { headers: headersFor(site) }),
  tasks: (params = {}, site) =>
    fetchJSON(`/api/controls/tasks${toQS(params)}`, { headers: headersFor(site) }),
  taskDetails: (id) => fetchJSON(`/api/controls/tasks/${id}/details`),
  attachments: (id) => fetchJSON(`/api/controls/tasks/${id}/attachments`),
  upload: (id, formData) =>
    fetch(`/api/controls/tasks/${id}/upload`, { method: "POST", body: formData }).then(asJSON),

  assistant: (id, body) =>
    fetchJSON(`/api/controls/tasks/${id}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        body || {
          question:
            "Aide pré-intervention : EPI, points à vérifier, appareil à utiliser, interprétation des mesures.",
          use_pre_images: true,
          attachment_ids: [],
        }
      ),
    }),

  complete: (id, payload) =>
    fetchJSON(`/api/controls/tasks/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  calendar: (site, params = {}) =>
    fetchJSON(`/api/controls/calendar${toQS(params)}`, { headers: headersFor(site) }),

  // --- Nouveaux endpoints: Audit IA ---
  aiAuditRun: (site, params = {}) =>
    fetchJSON(`/api/controls/ai/audit-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headersFor(site) },
      body: JSON.stringify(params || {}),
    }),
  aiAuditList: (site, params = {}) =>
    fetchJSON(`/api/controls/ai/audit${toQS(params)}`, { headers: headersFor(site) }),
};

function toQS(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
      if (j?.details) message += `: ${j.details}`;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}
async function asJSON(res) {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
      if (j?.details) message += `: ${j.details}`;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

/* ============================
   Icons (inline SVG, no deps)
============================ */
const Icon = {
  Search: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M21 21l-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Filter: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  ChevronDown: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  ChevronUp: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Refresh: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8M20 8V4h-4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 2v4M8 2v4M3 10h18" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Building: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M3 21h18M6 21V7h12v14M9 21v-4h6v4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Bolt: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Alert: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M20 6l-11 11-5-5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  Clock: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 6v6l4 2" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Camera: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M4 7h4l2-2h4l2 2h4v12H4z" fill="none" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Upload: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Paperclip: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 1 1 4.95 4.95l-9.19 9.19a2 2 0 1 1-2.83-2.83l7.78-7.78" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Send: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M22 2L11 13" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M22 2l-7 20-4-9-9-4 20-7z" fill="none" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  X: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
};

/* ============================
   Error Boundary (évite crash écran)
============================ */
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError:false, message: '' }; }
  static getDerivedStateFromError(err){ return { hasError:true, message: err?.message || 'Erreur inconnue' }; }
  componentDidCatch(){ /* no-op */ }
  render(){
    if (this.state.hasError) {
      return (
        <div style={{padding:12}}>
          <div className="error"><Icon.Alert /> <div>{this.state.message}</div></div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================
   Controls Page
============================ */
export default function Controls() {
  const [site, setSite] = useState(localStorage.getItem("controls_site") || "Nyon");
  const [tab, setTab] = useState("tasks");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [library, setLibrary] = useState(null);
  const [tree, setTree] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fQuery, setFQuery] = useState("");
  const [fBuilding, setFBuilding] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const [selectedId, setSelectedId] = useState(null);

  const qRef = useRef(null);
  useEffect(() => {
    if (qRef.current) clearTimeout(qRef.current);
    qRef.current = setTimeout(() => {
      if (tab === "tasks") refreshTasks();
    }, 350);
    return () => clearTimeout(qRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fQuery, fBuilding, fType, fStatus, onlyOverdue, site, tab]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const lib = await CONTROLS_API.library();
        setLibrary(lib);
        const t = await CONTROLS_API.tree(site);
        setTree(t);
        await refreshTasks(true);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  function resetFilters() {
    setFQuery("");
    setFBuilding("");
    setFType("");
    setFStatus("");
    setOnlyOverdue(false);
  }

  async function refreshTasks(hard = false) {
    try {
      setError("");
      const params = {
        q: fQuery || undefined,
        building: fBuilding || undefined,
        type: fType || undefined,
        status: fStatus || undefined,
      };
      const res = await CONTROLS_API.tasks(params, site);
      let list = res?.data || [];
      if (onlyOverdue) list = list.filter((x) => x.status === "Overdue");
      setTasks(list);
      if (hard) setSelectedId(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  function onChangeSite(v) {
    const next = (v || "").trim();
    setSite(next);
    localStorage.setItem("controls_site", next);
  }

  const buildings = useMemo(() => {
    const s = new Set();
    (tree || []).forEach((b) => s.add(b?.building || "—"));
    return Array.from(s);
  }, [tree]);

  // Normalise les types: parfois l'API peut renvoyer des objets
  const types = useMemo(() => {
    const arr = (library?.types || []);
    return arr.map((t) => toLabel(t)).filter(Boolean);
  }, [library]);

  return (
    <div className="controls-wrap">
      <TopBar
        site={site}
        setSite={onChangeSite}
        onRefresh={() => refreshTasks(true)}
      />

      <div className="container">
        <h1 className="page-title">Contrôles & Checklists</h1>

        <Tabs tab={tab} setTab={setTab} />

        {tab === "tasks" && (
          <>
            <FiltersBar
              query={fQuery}
              setQuery={setFQuery}
              filtersOpen={filtersOpen}
              setFiltersOpen={setFiltersOpen}
              buildings={buildings}
              types={types}
              fBuilding={fBuilding}
              setFBuilding={setFBuilding}
              fType={fType}
              setFType={setFType}
              fStatus={fStatus}
              setFStatus={setFStatus}
              onlyOverdue={onlyOverdue}
              setOnlyOverdue={setOnlyOverdue}
              onReset={resetFilters}
            />

            {error ? <ErrorBanner message={error} /> : null}
            {loading ? <SkeletonList /> : <TaskGrid tasks={tasks} onOpen={setSelectedId} />}

            {selectedId ? (
              <ErrorBoundary>
                <TaskModal id={selectedId} onClose={() => setSelectedId(null)} onCompleted={() => {
                  setSelectedId(null);
                  refreshTasks();
                }} />
              </ErrorBoundary>
            ) : null}
          </>
        )}

        {tab === "calendar" && <CalendarPanel site={site} onSelectTask={(id) => setSelectedId(id)} />}
        {tab === "audit" && <AIAuditPanel site={site} />}
      </div>

      <ToastRoot />

      {/* Page CSS */}
      <style>{styles}</style>
    </div>
  );
}

/* ============================
   Top Bar
============================ */
function TopBar({ site, setSite, onRefresh }) {
  const [siteInput, setSiteInput] = useState(site);
  useEffect(() => setSiteInput(site), [site]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><Icon.Bolt /></span>
        <span className="brand-name">ElectroHub · Contrôles</span>
      </div>
      <div className="top-actions">
        <div className="brand">
          <label>Site</label>
          <input
            className="input"
            value={siteInput}
            onChange={(e) => setSiteInput(e.target.value)}
            onBlur={() => setSite(siteInput)}
            placeholder="Site (ex: Nyon)"
          />
        </div>
        <button className="btn ghost" onClick={onRefresh} title="Rafraîchir">
          <Icon.Refresh /> <span>Rafraîchir</span>
        </button>
      </div>
    </header>
  );
}

/* ============================
   Tabs
============================ */
function Tabs({ tab, setTab }) {
  return (
    <div className="tabs">
      <button className={cls("tab", tab === "tasks" && "active")} onClick={() => setTab("tasks")}>
        <Icon.Search /> Tâches
      </button>
      <button className={cls("tab", tab === "calendar" && "active")} onClick={() => setTab("calendar")}>
        <Icon.Calendar /> Calendrier
      </button>
      <button className={cls("tab", tab === "audit" && "active")} onClick={() => setTab("audit")}>
        <Icon.Alert /> Audit&nbsp;IA
      </button>
    </div>
  );
}

/* ============================
   Filters
============================ */
function FiltersBar({
  query, setQuery,
  filtersOpen, setFiltersOpen,
  buildings, types,
  fBuilding, setFBuilding,
  fType, setFType,
  fStatus, setFStatus,
  onlyOverdue, setOnlyOverdue,
  onReset,
}) {
  return (
    <div className="filters">
      <div className="filters-row">
        <div className="search">
          <span className="icon"><Icon.Search /></span>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher..."
          />
        </div>
        <button className="btn ghost" onClick={() => setFiltersOpen(!filtersOpen)}>
          <Icon.Filter /> Filtres {filtersOpen ? <Icon.ChevronUp /> : <Icon.ChevronDown />}
        </button>
      </div>
      {filtersOpen ? (
        <div className="filters-panel">
          <div className="filter">
            <label>Bâtiment</label>
            <select className="input" value={fBuilding} onChange={(e) => setFBuilding(e.target.value)}>
              <option value="">Tous</option>
              {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="filter">
            <label>Type</label>
            <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">Tous</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="filter">
            <label>Statut</label>
            <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Tous</option>
              <option value="Overdue">En retard</option>
              <option value="Planned">Planifié</option>
              <option value="Pending">En attente</option>
              <option value="Completed">Complété</option>
            </select>
          </div>
          <div className="filter check">
            <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
            <label>Seulement en retard</label>
          </div>
          <div className="filter-actions">
            <button className="btn ghost" onClick={onReset}>Réinitialiser</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================
   Task Grid
============================ */
function TaskGrid({ tasks, onOpen }) {
  if (!tasks?.length) return <div className="empty">Aucune tâche trouvée.</div>;
  return (
    <div className="grid">
      {tasks.map((t) => (
        <div className="card" key={t.id} onClick={() => onOpen(t.id)}>
          <div className="card-head">
            <div className={cls("badge",
              t.status === "Overdue" && "red",
              t.status === "Planned" && "blue",
              t.status === "Pending" && "yellow"
            )}>
              {t.status}
            </div>
            <div className="chip code">{t.task_code || t.cluster}</div>
          </div>
          <div className="card-title"><SafeText value={t.task_name} /></div>
          <div className="card-sub">
            <div className="chip"><Icon.Building /> <SafeText value={t.building} /></div>
            <div className="chip"><Icon.Bolt /> <SafeText value={t.equipment_type} /></div>
          </div>
          <div className="card-entity"><SafeText value={t.entity_name} /> ({t.entity_code})</div>
          <div className="date"><Icon.Clock /> Suivant: <SafeText value={fmtDate(t.next_control)} /></div>
        </div>
      ))}
    </div>
  );
}

/* ============================
   Task Modal
============================ */
function TaskModal({ id, onClose, onCompleted }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [task, setTask] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [results, setResults] = useState({});
  const [notes, setNotes] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const details = await CONTROLS_API.taskDetails(id);
        setTask(details);
        const atts = await CONTROLS_API.attachments(id);
        setAttachments(atts);
      } catch (e) {
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function onUpload(e) {
    const fd = new FormData();
    for (const f of e.target.files) fd.append("files", f);
    try {
      await CONTROLS_API.upload(id, fd);
      const atts = await CONTROLS_API.attachments(id);
      setAttachments(atts);
      toast("Upload réussi");
    } catch (e) {
      toast("Erreur upload: " + e.message);
    }
  }

  async function assistant(question = "", attachment_ids = []) {
    try {
      setAiLoading(true);
      const res = await CONTROLS_API.assistant(id, { question, use_pre_images: true, attachment_ids });
      setAiMessage(res.message);
    } catch (e) {
      toast("Erreur IA: " + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  async function complete() {
    try {
      const res = await CONTROLS_API.complete(id, { user: "tech", results, notes });
      toast("Tâche complétée");
      onCompleted();
      if (res?.non_conformity) {
        setTimeout(() => toast("Non-conformité détectée. Ouvrez un suivi (follow-up)."), 100);
      }
    } catch (e) {
      toast("Erreur: " + e.message);
    }
  }

  if (loading) return <ModalSkeleton />;
  if (err) return <ErrorBanner message={err} />;

  // ---------- MODIF A) : fallback local si result_schema absent + bouton "Reconstruire" ----------
  let schema = Array.isArray(task?.result_schema?.items) ? task.result_schema.items : [];
  const tsdFallback = Array.isArray(task?.tsd_cluster_items) ? task.tsd_cluster_items : [];
  if (!schema.length && tsdFallback.length) {
    schema = tsdFallback.map(it => ({
      id: it.id,
      field: it.field,
      label: it.label,
      type: "check",
      unit: it.unit || null,
      comparator: it.comparator || null,
      threshold: it.threshold ?? null,
      threshold_text: (it.comparator || it.threshold != null)
        ? `${it.label} — ${it.comparator || ""} ${it.threshold ?? ""} ${it.unit || ""}`.trim()
        : "Choisir: Conforme / Non conforme / N.A."
    }));
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="mh-col">
            <div className="mh-title"><SafeText value={task.task_name} /></div>
            <div className="mh-sub">
              <div className="chip"><Icon.Building /> <SafeText value={task.building} /></div>
              <div className="chip"><Icon.Bolt /> <SafeText value={task.equipment_type} /></div>
              <div className="chip code"><SafeText value={task.entity_code} /></div>
            </div>
          </div>
          <button className="btn icon ghost" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">
          <div className="col form">
            <div className="section">
              <div className="section-title"><Icon.Check /> Checklist</div>

              {/* Bouton Reconstruire si vide */}
              {(!schema || !schema.length) ? (
                <div className="empty small">
                  Checklist vide.{" "}
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      try {
                        await fetch(`/api/controls/tasks/${id}/fix-schema`, { method: "POST" });
                        const details = await CONTROLS_API.taskDetails(id);
                        setTask(details);
                        toast("Checklist reconstruite");
                      } catch (e) {
                        toast("Impossible de reconstruire: " + e.message);
                      }
                    }}
                  >
                    Reconstruire
                  </button>
                </div>
              ) : null}

              <div className="group-fields">
                {schema.map((it) => (
                  <div key={it.id} className="group-item">
                    <div className="gi-head">
                      <div className="gi-label"><SafeText value={it.label} /></div>
                      <div className="gi-rule"><SafeText value={it.threshold_text} /></div>
                    </div>
                    {/* Tri-state conforme / non conforme / N.A. */}
                    <div className="field">
                      <label className="hint">Résultat</label>
                      <select
                        className="input"
                        value={results[it.id] ?? ""}
                        onChange={(e) => setResults({ ...results, [it.id]: e.target.value })}
                      >
                        <option value="">—</option>
                        <option value="conforme">Conforme</option>
                        <option value="non_conforme">Non conforme</option>
                        <option value="na">Non applicable</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title"><Icon.Camera /> Photos & Pièces jointes</div>
              <AttachmentList taskId={id} attachments={attachments} />
              <div className="upload-line">
                <label className="btn">
                  <Icon.Upload /> Ajouter fichiers
                  <input type="file" multiple onChange={onUpload} style={{display:'none'}} />
                </label>
              </div>
            </div>

            <div className="section">
              <div className="section-title"><Icon.Send /> Notes</div>
              <textarea className="input textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes optionnelles..." />
            </div>

            <div className="actions">
              <button className="btn primary" onClick={complete}>Compléter</button>
            </div>
          </div>

          <div className="col side">
            <div className="section">
              <div className="section-title"><Icon.Alert /> Procédure & Sécurité</div>
              <div className="callout">
                <div className="callout-title"><Icon.Alert /> Dangers</div>
                <div className="callout-text"><SafeText value={task.hazards_md || "—"} /></div>
              </div>
              <div className="callout">
                <div className="callout-title"><Icon.Bolt /> EPI</div>
                <div className="callout-text"><SafeText value={task.ppe_md || "—"} /></div>
              </div>
              <div className="callout">
                <div className="callout-title"><Icon.Clock /> Outils</div>
                <div className="callout-text"><SafeText value={task.tools_md || "—"} /></div>
              </div>
              <div className="callout">
                <div className="callout-title"><Icon.Check /> Procédure</div>
                <div className="callout-text"><SafeText value={task.procedure_md || "—"} /></div>
              </div>
            </div>

            {/* ---------- MODIF B) : UI claire Guidage / Interprétation photo ---------- */}
            <div className="section ai-box">
              <div className="section-title"><Icon.Bolt /> Assistant IA</div>

              <div className="ai-actions" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
                <button
                  className="btn ghost"
                  onClick={() => assistant("Guidage pré-intervention (EPI, points de contrôle, appareil de mesure, valeurs attendues)")}
                  disabled={aiLoading}
                >
                  Guidage pré-intervention
                </button>

                <span style={{fontSize:12, color:"#475569"}}>ou</span>

                <select id="ai-photo" className="input" style={{width:240}}>
                  <option value="">— choisir une photo à interpréter —</option>
                  {attachments.filter(a => (a.mimetype||"").startsWith("image/")).map(a =>
                    <option key={a.id} value={a.id}>{a.filename}</option>
                  )}
                </select>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const sel = document.getElementById("ai-photo");
                    const attId = sel ? Number(sel.value) : 0;
                    if (!attId) return toast("Choisis une photo d'abord");
                    assistant("Interprétation de la photo (lire valeurs, état visuel, remarques sécurité)", [attId]);
                  }}
                  disabled={aiLoading}
                >
                  Interpréter la photo
                </button>
              </div>

              {aiMessage ? <div className="ai-answer"><pre>{aiMessage}</pre></div> : (
                <div className="ai-answer" style={{opacity:.8}}>
                  <div className="ai-title">Exemples :</div>
                  <ul style={{margin:'6px 0 0 18px', padding:0}}>
                    <li>Guidage pré-intervention : EPI requis, points à vérifier, seuils et tolérances.</li>
                    <li>Interprétation photo : lecture d’un écran (tension/courant), état d’un isolant, présence d’échauffement…</li>
                  </ul>
                </div>
              )}
            </div>
            {/* ---------- fin modif B ---------- */}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================
   Calendar Panel
============================ */
function CalendarPanel({ site, onSelectTask }) {
  const [month, setMonth] = useState(new Date());
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      const from = new Date(month); from.setDate(1); from.setMonth(from.getMonth() - 1);
      const to = new Date(month); to.setDate(1); to.setMonth(to.getMonth() + 2); to.setDate(0);
      try {
        setErr("");
        const data = await CONTROLS_API.calendar(site, { from: toISODate(from), to: toISODate(to) });
        // Le backend renvoie un tableau brut
        setItems(Array.isArray(data) ? data : (data?.rows || []));
      } catch (e) {
        setErr(e.message || String(e));
      }
    })();
  }, [month, site]);

  function prev() { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); }
  function next() { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }

  const grid = buildMonthGrid(month);
  const byDay = new Map();
  for (const it of items) {
    const key = toISODate(new Date(it.next_control));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(it);
  }

  return (
    <div className="calendar-panel">
      <div className="cal-head">
        <button className="btn ghost" onClick={prev}>‹</button>
        <div className="cal-title"><Icon.Calendar /> {month.toLocaleDateString(undefined, { year: "numeric", month: "long" })}</div>
        <button className="btn ghost" onClick={next}>›</button>
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div className="cal-grid">
        {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {grid.map((cell, i) => {
          const key = toISODate(cell.date);
          const list = byDay.get(key) || [];
          return (
            <div key={i} className={cls("cal-cell", cell.otherMonth && "muted")}>
              <div className="cal-day">{cell.date.getDate()}</div>
              <div className="cal-list">
                {list.slice(0, 4).map(ev => (
                  <div
                    key={ev.id}
                    className={cls("cal-item", ev.status === "Overdue" && "red", ev.status === "Planned" && "blue")}
                    onClick={() => onSelectTask(ev.id)}
                  >
                    <SafeText value={ev.entity_name} /> · <SafeText value={ev.task_name} />
                  </div>
                ))}
                {list.length > 4 ? <div className="cal-more">+{list.length - 4} autres…</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function toISODate(d) { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); }
function buildMonthGrid(firstOfMonth) {
  const start = new Date(firstOfMonth);
  const firstDay = (start.getDay() + 6) % 7; // Monday start
  const startDate = new Date(start); startDate.setDate(1 - firstDay);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(startDate); dt.setDate(startDate.getDate() + i);
    cells.push({ date: dt, otherMonth: dt.getMonth() !== firstOfMonth.getMonth() });
  }
  return cells;
}

/* ============================
   Attachments list
============================ */
function AttachmentList({ taskId, attachments }) {
  if (!attachments?.length) return <div className="empty small">Aucune pièce jointe.</div>;
  return (
    <div className="attachments">
      {attachments.map((a) => (
        <a
          key={a.id}
          className="att"
          href={`/api/controls/tasks/${taskId}/attachments/${a.id}`}
          target="_blank" rel="noreferrer"
          title={`${a.filename} (${a.size || 0} o)`}
        >
          <Icon.Paperclip /> <span className="name"><SafeText value={a.filename} /></span>
          <span className="meta"><SafeText value={a.mimetype || "—"} /> • <SafeText value={a.size ?? "?"} /> o</span>
        </a>
      ))}
    </div>
  );
}

/* ============================
   UI helpers
============================ */
function ErrorBanner({ message }) {
  return (
    <div className="error">
      <Icon.Alert /> <div>{message}</div>
    </div>
  );
}
function SkeletonList() {
  return (
    <div className="grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="card skeleton" key={i}>
          <div className="line w40"></div>
          <div className="line w70"></div>
          <div className="line w50"></div>
        </div>
      ))}
    </div>
  );
}
function ModalSkeleton() {
  return (
    <div className="modal-body">
      <div className="col form">
        <div className="line w80"></div>
        <div className="line w60"></div>
        <div className="line w90"></div>
      </div>
      <div className="col side">
        <div className="line w70"></div>
        <div className="line w50"></div>
        <div className="line w60"></div>
      </div>
    </div>
  );
}

/* ============================
   Toast (minimal)
============================ */
let TOASTS = [];
let setToastState;
function ToastRoot() {
  const [, set] = useState(0);
  setToastState = set;
  useEffect(() => () => { setToastState = null; }, []);
  return (
    <div className="toasts">
      {TOASTS.map((t) => (
        <div className="toast" key={t.id}>{t.text}</div>
      ))}
    </div>
  );
}
function toast(text) {
  const id = Math.random().toString(36).slice(2);
  TOASTS.push({ id, text });
  setToastState && setToastState(Date.now());
  setTimeout(() => {
    TOASTS = TOASTS.filter((x) => x.id !== id);
    setToastState && setToastState(Date.now());
  }, 3500);
}

/* ============================
   AI Audit Panel
============================ */
function AIAuditPanel({ site }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const [recent, setRecent] = useState(20);
  const [past, setPast] = useState(50);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const res = await CONTROLS_API.aiAuditList(site);
        setItems(res || []);
      } catch (e) {
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [site]);

  async function runAudit() {
    try {
      setLoading(true);
      setErr("");
      await CONTROLS_API.aiAuditRun(site, { recent, past });
      const res = await CONTROLS_API.aiAuditList(site);
      setItems(res || []);
      toast("Audit IA terminé");
    } catch (e) {
      setErr(e.message || String(e));
      toast("Erreur audit: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="audit-panel">
      <div className="audit-head">
        <button className="btn" onClick={runAudit} disabled={loading}>
          <Icon.Refresh /> {loading ? 'En cours...' : 'Lancer Audit IA'}
        </button>
        <div className="audit-params">
          <div className="filter">
            <label>Récent (n)</label>
            <input type="number" className="input" value={recent} onChange={(e) => setRecent(Number(e.target.value))} min={5} />
          </div>
          <div className="filter">
            <label>Passé (n)</label>
            <input type="number" className="input" value={past} onChange={(e) => setPast(Number(e.target.value))} min={10} />
          </div>
        </div>
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      {loading ? <SkeletonList /> : (
        items.length === 0 ? <div className="empty">Aucun résultat d'audit pour le moment. Lancez un audit pour analyser les dérives.</div> : (
          <div className="grid">
            {items.map((it) => (
              <div className="card" key={it.id}>
                <div className="card-head">
                  <div className="card-title"><SafeText value={it.entity_name} /> ({it.entity_code})</div>
                  <div className="chip code"><SafeText value={it.task_code} /></div>
                </div>
                <div className="card-sub">
                  <div className="badge red">Drift: {(it.drift_score * 100).toFixed(1)}%</div>
                  <div className="badge yellow">NC Rate: {(it.nc_rate * 100).toFixed(1)}%</div>
                </div>
                <div className="date"><Icon.Clock /> Échantillon: {it.sample_size} • Dernière: <SafeText value={fmtDT(it.last_eval)} /></div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ============================
   CSS (fonds blancs / texte noir)
============================ */
const styles = `
:root {
  --bg: #f6f7fb;
  --card: #fff;
  --text: #111;
  --muted: #6b7280;
  --primary: #0ea5e9;
  --primary-600: #0284c7;
  --blue-50: #eff6ff;
  --green: #16a34a;
  --yellow: #f59e0b;
  --red: #dc2626;
  --border: #e5e7eb;
  --chip: #eef2f7;
}

* { box-sizing:border-box; }
html, body, #root { height: 100%; }
body { margin:0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji","Segoe UI Emoji"; }

.controls-wrap .container { width: 100%; max-width: 1200px; padding: 16px; margin: 0 auto; }
.page-title { font-size: 24px; margin: 16px 0 8px; }

.topbar { position: sticky; top: 0; z-index: 10; display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:#fff; border-bottom:1px solid var(--border); }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; }
.logo svg { color: var(--primary); }
.top-actions { display:flex; align-items:flex-end; gap:12px; }
.site-picker label { font-size:12px; color:var(--muted); display:block; margin-bottom:4px; }
.input { background:#fff; color:#000; border:1px solid var(--border); border-radius:8px; padding:10px 12px; width:100%; }
.input:focus { outline:2px solid var(--primary); border-color: transparent; }
.textarea { min-height: 90px; resize: vertical; }

.btn { display:inline-flex; align-items:center; gap:8px; background: var(--primary); color:#fff; border:none; border-radius:10px; padding:10px 12px; cursor:pointer; font-weight:600; }
.btn:hover { background: var(--primary-600); }
.btn.ghost { background:#fff; color:#111; border:1px solid var(--border); }
.btn.icon { padding:8px; border-radius:8px; }
.btn.primary { background: var(--green); }
.btn.primary:hover { background: #15803d; }

.tabs { display:flex; gap:8px; margin: 8px 0 16px; }
.tab { background:#fff; border:1px solid var(--border); border-radius:999px; padding:8px 12px; display:inline-flex; gap:8px; align-items:center; cursor:pointer; }
.tab.active { background: var(--blue-50); border-color:#bfdbfe; }

.filters { background:#fff; border:1px solid var(--border); border-radius:12px; padding:12px; margin: 8px 0 16px; }
.filters-row { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
.search { position:relative; flex:1; min-width: 220px; }
.search .icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--muted); }
.search .input { padding-left:36px; }
.filters-panel { margin-top:10px; display:grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap:12px; }
.filter { display:flex; flex-direction:column; gap:6px; }
.filter.check { flex-direction:row; align-items:center; gap:8px; }
.filter-actions { grid-column: 1 / -1; display:flex; justify-content:flex-end; }

.grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.card { background: var(--card); border:1px solid var(--border); border-radius:12px; padding:12px; cursor:pointer; transition: transform .05s ease, box-shadow .15s ease; }
.card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.06); transform: translateY(-1px); }
.card-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.card-title { font-weight:700; margin-bottom:8px; }
.card-sub { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
.card-entity { color:var(--muted); }
.date { display:flex; gap:6px; align-items:center; color:var(--muted); font-size: 12px; }
.badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 8px; border-radius:999px; background: var(--blue-50); color:#0b4a6f; border:1px solid var(--border); }
.badge.green { background:#ecfdf5; color:#065f46; }
.badge.red { background:#fef2f2; color:#991b1b; }
.badge.blue { background:#eff6ff; color:#1e40af; }
.badge.yellow { background:#fffbeb; color:#92400e; border-color:#fde68a; }
.chip { display:inline-flex; gap:6px; align-items:center; background: var(--chip); color:#111; border:1px solid var(--border); padding:4px 8px; border-radius:999px; font-size:12px; }
.chip.code { background:#fafafa; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.error { display:flex; gap:8px; align-items:flex-start; background:#fef2f2; border:1px solid #fecaca; color:#7f1d1d; padding:12px; border-radius:10px; margin: 12px 0; }

.empty { text-align:center; color:var(--muted); padding:24px; }
.empty.small { padding:8px; text-align:left; }

.modal { position: fixed; inset:0; background: rgba(0,0,0,.28); display:flex; align-items:flex-start; justify-content:center; padding:20px; z-index: 50; overflow:auto; }
.modal-card { width: 100%; max-width: 1100px; background:#fff; border-radius:14px; border:1px solid var(--border); }
.modal-head { padding:12px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); }
.mh-title { font-weight:800; font-size:18px; }
.mh-sub { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; color:var(--muted); }
.modal-body { display:grid; grid-template-columns: 1.3fr .9fr; gap:16px; padding:12px; }
.col { display:flex; flex-direction:column; gap:12px; }
.section { background:#fff; border:1px solid var(--border); border-radius:10px; padding:12px; }
.section-title { font-weight:700; margin-bottom:6px; display:flex; align-items:center; gap:8px; }
.hint { font-size: 13px; color: var(--muted); margin-bottom:6px; }
.rule { font-size: 12px; color:#1f2937; background:#f3f4f6; border:1px solid var(--border); padding:8px; border-radius:8px; margin-bottom:8px; }
.field { display:flex; flex-direction:column; gap:6px; }
.field.check { flex-direction:row; align-items:center; gap:8px; }
.checklist { display:flex; flex-direction:column; gap:6px; }
.ck-item { display:flex; gap:8px; align-items:center; }
.group-fields { display:flex; flex-direction:column; gap:12px; }
.group-item { border:1px solid var(--border); border-radius:10px; padding:10px; background:#fff; }
.gi-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
.gi-label { font-weight:700; }
.gi-rule { font-size:12px; color:#374151; background:#f8fafc; border:1px dashed var(--border); padding:4px 6px; border-radius:8px; }
.actions { display:flex; gap:8px; justify-content:flex-end; }

.callout { background:#fafafa; border:1px solid var(--border); border-radius:10px; padding:12px; }
.callout-title { font-weight:700; display:flex; gap:8px; align-items:center; margin-bottom:4px; }
.callout-text { font-size:13px; color:var(--muted); margin-bottom:8px; }

.upload-line { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.file-pill { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; border:1px solid var(--border); background:#fff; font-size:12px; }
.files-list { display:flex; gap:6px; flex-wrap:wrap; }

.attachments { display:flex; flex-direction:column; gap:8px; }
.att { display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--border); border-radius:8px; text-decoration:none; color:inherit; background:#fff; }
.att:hover { background:#f8fafc; }

.ai-box { display:flex; flex-direction:column; gap:8px; }
.ai-actions { display:flex; gap:8px; flex-wrap:wrap; }
.ai-answer { background:#fafafa; border:1px solid var(--border); border-radius:8px; padding:8px; }
.ai-title { font-weight:700; margin-bottom:4px; }
.ai-answer pre { margin:0; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:12px; }

.skeleton .line { height: 10px; background: linear-gradient(90deg, #f1f5f9, #e2e8f0, #f1f5f9); background-size: 200% 100%; animation: sk 1.2s ease-in-out infinite; border-radius:6px; margin:8px 0; }
.skeleton .w40 { width:40%; }
.skeleton .w50 { width:50%; }
.skeleton .w60 { width:60%; }
.skeleton .w70 { width:70%; }
.skeleton .w80 { width:80%; }
.skeleton .w90 { width:90%; }
@keyframes sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; }
}

.toasts { position: fixed; right: 16px; bottom: 16px; display:flex; flex-direction:column; gap:8px; z-index: 60; }
.toast { background:#111; color:#fff; padding:10px 12px; border-radius:10px; box-shadow:0 6px 18px rgba(0,0,0,.2); max-width: 70vw; }

*::selection { background: #bae6fd; }

 /* Calendar */
.calendar-panel { background:#fff; border:1px solid var(--border); border-radius:12px; padding:12px; }
.cal-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.cal-title { font-weight:800; display:flex; gap:8px; align-items:center; }
.cal-grid { display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; }
.cal-dow { font-size:12px; color:#475569; text-align:center; padding:6px 0; }
.cal-cell { border:1px solid var(--border); border-radius:10px; background:#fff; min-height:104px; padding:6px; display:flex; flex-direction:column; gap:4px; }
.cal-cell.muted { background:#fafafa; color:#6b7280; }
.cal-day { font-size:12px; color:#64748b; }
.cal-list { display:flex; flex-direction:column; gap:4px; }
.cal-item { font-size:12px; line-height:1.25; padding:4px 6px; border-radius:6px; background:#eff6ff; cursor:pointer; border:1px solid var(--border); }
.cal-item.red { background:#fef2f2; }
.cal-item.blue { background:#eff6ff; }
.cal-more { font-size:11px; color:#64748b; }

@media (max-width: 980px) {
  .filters-panel { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
  .modal-body { grid-template-columns: 1fr; }
  .cal-cell { min-height:88px; }
}
@media (max-width: 600px) {
  .filters-row { gap:8px; }
  .filters-panel { grid-template-columns: 1fr; }
  .grid { grid-template-columns: 1fr; }
}
`;
