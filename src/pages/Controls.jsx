// src/pages/Controls.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ============================
   API utils
============================ */
function headersFor(site) {
  return site ? { "X-Site": site } : {};
}
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
      // on indique que l'IA peut analyser les pièces jointes et les seuils TSD
      body: JSON.stringify(
        body || {
          question: "Aide pré-intervention : EPI, points à vérifier, appareil à utiliser, interprétation des mesures.",
          analyze_attachments: true,
          analyze_thresholds: true,
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
   Helpers
============================ */
function cls(...a) { return a.filter(Boolean).join(" "); }
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtDT = (s) => (s ? new Date(s).toLocaleString() : "—");

/* ============================
   Controls Page
============================ */
export default function Controls() {
  // Par défaut on part sur Nyon (pas de "Default")
  const [site, setSite] = useState(localStorage.getItem("controls_site") || "Nyon");
  const [tab, setTab] = useState("tasks"); // "tasks" | "calendar"

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [library, setLibrary] = useState(null);
  const [tree, setTree] = useState([]);
  const [tasks, setTasks] = useState([]);

  // Filtres (repliables)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fQuery, setFQuery] = useState("");
  const [fBuilding, setFBuilding] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  // Sélection tâche (modal)
  const [selectedId, setSelectedId] = useState(null);

  // Debounce recherche
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
    tree.forEach((b) => s.add(b.building || "—"));
    return Array.from(s);
  }, [tree]);

  const types = useMemo(() => (library?.types || []), [library]);

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
              <TaskModal id={selectedId} onClose={() => setSelectedId(null)} onCompleted={() => {
                setSelectedId(null);
                refreshTasks();
              }} />
            ) : null}
          </>
        )}

        {tab === "calendar" && <CalendarPanel site={site} onSelectTask={(id) => setSelectedId(id)} />}
      </div>

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
        <div className="site-picker">
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
            placeholder="Recherche tâche / code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn" onClick={() => setFiltersOpen(!filtersOpen)}>
          <Icon.Filter /> <span>Filtres</span> {filtersOpen ? <Icon.ChevronUp/> : <Icon.ChevronDown/>}
        </button>
      </div>

      {filtersOpen && (
        <div className="filters-panel">
          <div className="filter">
            <label>Bâtiment</label>
            <select className="input" value={fBuilding} onChange={(e) => setFBuilding(e.target.value)}>
              <option value="">Tous</option>
              {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="filter">
            <label>Type équipement</label>
            <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">Tous</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="filter">
            <label>Statut</label>
            <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Tous</option>
              <option value="Pending">À faire (1ʳᵉ)</option>
              <option value="Planned">Planifié</option>
              <option value="Overdue">En retard</option>
              <option value="Completed">Terminé</option>
            </select>
          </div>
          <div className="filter check">
            <input id="overdue" type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
            <label htmlFor="overdue">Seulement en retard</label>
          </div>

          <div className="filter-actions">
            <button className="btn ghost" onClick={onReset}><Icon.Refresh /> Réinitialiser</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================
   Task Grid + Cards
============================ */
function TaskGrid({ tasks, onOpen }) {
  if (!tasks.length) return <div className="empty">Aucune tâche trouvée.</div>;
  return (
    <div className="grid">
      {tasks.map((t) => (
        <TaskCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />
      ))}
    </div>
  );
}

function statusBadge(s) {
  switch (s) {
    case "Overdue": return <span className="badge red"><Icon.Alert /> En retard</span>;
    case "Completed": return <span className="badge green"><Icon.Check /> Terminé</span>;
    case "Pending": return <span className="badge yellow"><Icon.Clock /> À faire (1ʳᵉ)</span>;
    default: return <span className="badge blue"><Icon.Clock /> Planifié</span>;
  }
}
function typeLabel(t) {
  switch (t) {
    case "LV_SWITCHBOARD": return "Tableau BT";
    case "LV_DEVICE": return "Appareil BT";
    case "HV_EQUIPMENT": return "HT (>1000V)";
    case "ATEX_EQUIPMENT": return "ATEX";
    default: return t || "—";
  }
}

function TaskCard({ t, onOpen }) {
  return (
    <div className="card" onClick={onOpen} role="button">
      <div className="card-head">
        {statusBadge(t.status)}
        <div className="date"><Icon.Calendar /> {t.next_control ? fmtDate(t.next_control) : "À planifier"}</div>
      </div>
      <div className="card-title">{t.task_name}</div>
      <div className="card-sub">
        <span className="chip"><Icon.Building /> {t.building || "—"}</span>
        <span className="chip"><Icon.Bolt /> {typeLabel(t.equipment_type)}</span>
      </div>
      <div className="card-entity">
        Équipement : <strong>{t.entity_name || "—"}</strong>
        {t.entity_code ? <span className="mono"> ({t.entity_code})</span> : null}
      </div>
    </div>
  );
}

/* ============================
   Task Modal (details)
============================ */
function TaskModal({ id, onClose, onCompleted }) {
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const [problem, setProblem] = useState("");

  const [attachments, setAttachments] = useState([]);
  const [preFiles, setPreFiles] = useState([]);
  const [workFiles, setWorkFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [results, setResults] = useState({});
  const [notes, setNotes] = useState("");

  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setProblem("");
        const d = await CONTROLS_API.taskDetails(id);
        setDetails(d);
        setResults(d?.results || {});
        const atts = await CONTROLS_API.attachments(id);
        setAttachments(atts || []);
        setAiAnswer("");
      } catch (e) {
        setProblem(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const rs = details?.result_schema || {};
  const isGroup = Array.isArray(rs?.items) && rs.items.length > 0;

  async function refreshAttachments() {
    try {
      const atts = await CONTROLS_API.attachments(id);
      setAttachments(atts || []);
    } catch (e) {
      setProblem(e.message || String(e));
    }
  }

  function handleResultChange(field, value) {
    setResults((r) => ({ ...r, [field]: value }));
  }

  async function doUpload(kind) {
    const files = kind === "pre" ? preFiles : workFiles;
    if (!files?.length) return;
    try {
      setUploading(true);
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      fd.append("label", kind === "pre" ? "pre" : "work");
      await CONTROLS_API.upload(id, fd);
      if (kind === "pre") setPreFiles([]);
      else setWorkFiles([]);
      await refreshAttachments();
    } catch (e) {
      setProblem(e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  async function askAssistant(question) {
    try {
      setAiLoading(true);
      setAiAnswer("");
      const body = {
        question: question || aiText || "Aide pré-intervention : EPI, points de mesure, appareil, interprétation.",
        analyze_attachments: true,
        analyze_thresholds: true,
      };
      const res = await CONTROLS_API.assistant(id, body);
      setAiAnswer(res?.message || "");
    } catch (e) {
      setProblem(e.message || String(e));
    } finally {
      setAiLoading(false);
    }
  }

  async function completeTask() {
    try {
      setProblem("");
      const payload = {
        user: localStorage.getItem("controls_user") || "Technicien",
        results: results || {}, // non-null
        notes,
      };
      const res = await CONTROLS_API.complete(id, payload);
      toast("Tâche clôturée. Prochain contrôle: " + fmtDate(res?.next_control));
      onCompleted?.();
    } catch (e) {
      setProblem(e.message || String(e));
    }
  }

  const thresholdBox = useMemo(() => {
    if (details?.threshold_text) return details.threshold_text;
    if (isGroup && rs.items.some((it) => it?.threshold_text)) {
      return rs.items
        .filter((it) => it?.threshold_text)
        .map((it) => `${it.label}: ${it.threshold_text}`)
        .join(" • ");
    }
    return "";
  }, [details, rs, isGroup]);

  const clusterNotes = details?.tsd_cluster_items || []; // consignes/points regroupés côté serveur

  return (
    <div className="modal">
      <div className="modal-card">
        <div className="modal-head">
          <div className="mh-left">
            <div className="mh-title">{details?.task_name || "Chargement..."}</div>
            <div className="mh-sub">
              <span className="chip"><Icon.Bolt /> {typeLabel(details?.equipment_type)}</span>
              <span className="chip"><Icon.Building /> {details?.building || "—"}</span>
              {details?.entity_code ? <span className="chip code">Équipement: {details?.entity_code}</span> : null}
              {details?.task_code ? <span className="chip code">Code tâche: {details?.task_code}</span> : null}
            </div>
          </div>
          <button className="btn icon ghost" onClick={onClose} title="Fermer"><Icon.X /></button>
        </div>

        {problem ? <ErrorBanner message={`Chargement des détails: ${problem}`} /> : null}
        {loading ? <ModalSkeleton /> : (
          <div className="modal-body">
            {/* Colonne gauche: checklist / champs */}
            <div className="col form">
              {/* Alerte pré-intervention (optionnelle) */}
              <div className="callout">
                <div className="callout-title"><Icon.Camera /> Photo de pré-intervention (optionnelle)</div>
                <div className="callout-text">
                  Avant d’intervenir, vous pouvez ajouter une photo (vue d’ensemble, plaques, repères).
                  L’assistant expliquera où mesurer et avec quel appareil. Ce n’est pas obligatoire.
                </div>
                <div className="upload-line">
                  <label className="btn">
                    <Icon.Upload /> Joindre photo(s)
                    <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => setPreFiles(Array.from(e.target.files || []))}/>
                  </label>
                  <button className="btn ghost" disabled={!preFiles.length || uploading} onClick={() => doUpload("pre")}>
                    <Icon.Send /> Envoyer
                  </button>
                  <div className="files-list">
                    {preFiles.map((f, i) => <span key={i} className="file-pill">{f.name}</span>)}
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="section-title">Checklist & Mesures</div>
                {thresholdBox ? <div className="rule">{thresholdBox}</div> : null}

                {/* Consignes / points du cluster (ex: a) à h)) */}
                {clusterNotes?.length ? (
                  <div className="hint">
                    <strong>Consignes TSD (points à observer) :</strong>
                    <ul style={{margin:'6px 0 0 18px'}}>
                      {clusterNotes.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}

                {isGroup ? (
                  <GroupFields
                    items={rs.items}
                    results={results}
                    onChange={handleResultChange}
                  />
                ) : (
                  <SingleField
                    schema={rs}
                    results={results}
                    onChange={handleResultChange}
                  />
                )}

                <div className="field">
                  <label>Notes / Observations</label>
                  <textarea
                    className="input textarea"
                    placeholder="Observations, conditions de test, EPI, risques, etc."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="actions">
                  <button className="btn primary" onClick={completeTask}><Icon.Check /> Clôturer la tâche</button>
                </div>
              </div>
            </div>

            {/* Colonne droite: PJ + IA */}
            <div className="col side">
              <div className="section">
                <div className="section-title"><Icon.Paperclip /> Pièces jointes</div>
                <div className="upload-line">
                  <label className="btn">
                    <Icon.Upload /> Ajouter pendant contrôle
                    <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={(e) => setWorkFiles(Array.from(e.target.files || []))}/>
                  </label>
                  <button className="btn ghost" disabled={!workFiles.length || uploading} onClick={() => doUpload("work")}>
                    <Icon.Send /> Envoyer
                  </button>
                </div>
                <div className="files-list">
                  {workFiles.map((f, i) => <span key={i} className="file-pill">{f.name}</span>)}
                </div>

                <AttachmentList taskId={id} attachments={attachments} />
              </div>

              <div className="section">
                <div className="section-title"><Icon.Bolt /> Assistant IA</div>
                <div className="hint">
                  Joignez des photos d’écrans d’appareils de mesure : l’IA interprète les valeurs et vérifie les seuils TSD.
                </div>
                <div className="ai-box">
                  <textarea
                    className="input textarea"
                    placeholder="Posez une question (ex: Quelle méthode pour mesurer l’isolement ?)"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                  />
                  <div className="ai-actions">
                    <button className="btn" onClick={() => askAssistant()} disabled={aiLoading}><Icon.Send /> Conseils</button>
                    <button className="btn ghost" onClick={() => askAssistant("Analyse des pièces jointes et des résultats vs seuils TSD.")} disabled={aiLoading}><Icon.Search /> Analyser</button>
                  </div>
                  {aiAnswer ? <div className="ai-answer"><div className="ai-title">Réponse</div><pre>{aiAnswer}</pre></div> : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ToastRoot />
    </div>
  );
}

/* ============================
   Fields renderers
============================ */
function SingleField({ schema, results, onChange }) {
  if (!schema || !schema.field) {
    return (
      <div className="field">
        <label>Résultat (texte)</label>
        <input className="input" value={results["value"] || ""} onChange={(e) => onChange("value", e.target.value)} />
      </div>
    );
  }
  const field = schema.field;
  const type = normalizeType(schema.type);

  // checklist simple -> tri-état par item si schema.checklist est fourni
  if (type === "checklist" && Array.isArray(schema.checklist) && schema.checklist.length) {
    const current = (results[field] && typeof results[field] === "object") ? results[field] : {};
    function setItem(item, v) {
      onChange(field, { ...current, [item]: v });
    }
    return (
      <div className="field">
        <label>Checklist</label>
        <div className="group-fields">
          {schema.checklist.map((item) => (
            <div key={item} className="group-item">
              <div className="gi-head"><div className="gi-label">{item}</div></div>
              <div className="field">
                <label>Conformité</label>
                <select className="input" value={current[item] ?? ""} onChange={(e) => setItem(item, e.target.value)}>
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
    );
  }

  if (type === "number") {
    return (
      <div className="field">
        <label>Valeur {schema.unit ? `(${schema.unit})` : ""}</label>
        <input
          className="input"
          type="number"
          step="any"
          value={results[field] ?? ""}
          onChange={(e) => onChange(field, e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={schema.unit ? `Ex: 12.5 ${schema.unit}` : "Ex: 12.5"}
        />
      </div>
    );
  }
  if (type === "select" && Array.isArray(schema.options)) {
    return (
      <div className="field">
        <label>Choix</label>
        <select className="input" value={results[field] ?? ""} onChange={(e) => onChange(field, e.target.value)}>
          <option value="">—</option>
          {schema.options.map((o) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
        </select>
      </div>
    );
  }
  if (type === "check" || type === "boolean") {
    const val = results[field] ?? "";
    return (
      <div className="field">
        <label>Conformité</label>
        <select className="input" value={val} onChange={(e) => onChange(field, e.target.value)}>
          <option value="">—</option>
          <option value="conforme">Conforme</option>
          <option value="non_conforme">Non conforme</option>
          <option value="na">Non applicable</option>
        </select>
      </div>
    );
  }
  // text
  return (
    <div className="field">
      <label>Observation</label>
      <input className="input" value={results[field] ?? ""} onChange={(e) => onChange(field, e.target.value)} placeholder="Renseigner le résultat"/>
    </div>
  );
}

function GroupFields({ items, results, onChange }) {
  return (
    <div className="group-fields">
      {items.map((it) => {
        const t = normalizeType(it.type);
        const field = it.field || it.id;
        const unit = it.unit ? ` (${it.unit})` : "";

        // checklist multi-points -> tri-état PAR POINT
        if (t === "checklist" && Array.isArray(it.options) && it.options.length) {
          const curr = (results[field] && typeof results[field] === "object") ? results[field] : {};
          function setItem(optKey, v) {
            onChange(field, { ...curr, [optKey]: v });
          }
          return (
            <div key={field} className="group-item">
              <div className="gi-head">
                <div className="gi-label">{it.label}</div>
                {it.threshold_text ? <div className="gi-rule">{it.threshold_text}</div> : null}
              </div>
              <div className="group-fields">
                {it.options.map((opt) => {
                  const key = opt.value || opt.key || opt;
                  const label = opt.label || opt.name || opt;
                  return (
                    <div key={key} className="group-item" style={{padding:'8px'}}>
                      <div className="gi-head"><div className="gi-label">{label}</div></div>
                      <div className="field">
                        <label>Conformité</label>
                        <select className="input" value={curr[key] ?? ""} onChange={(e) => setItem(key, e.target.value)}>
                          <option value="">—</option>
                          <option value="conforme">Conforme</option>
                          <option value="non_conforme">Non conforme</option>
                          <option value="na">Non applicable</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={field} className="group-item">
            <div className="gi-head">
              <div className="gi-label">{it.label}</div>
              {it.threshold_text ? <div className="gi-rule">{it.threshold_text}</div> : null}
            </div>

            {t === "number" && (
              <div className="field">
                <label>Valeur{unit}</label>
                <input
                  className="input"
                  type="number"
                  step="any"
                  value={results[field] ?? ""}
                  onChange={(e) => onChange(field, e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder={it.unit ? `Ex: 12.5 ${it.unit}` : "Ex: 12.5"}
                />
              </div>
            )}

            {t === "select" && Array.isArray(it.options) && (
              <div className="field">
                <label>Choix</label>
                <select className="input" value={results[field] ?? ""} onChange={(e) => onChange(field, e.target.value)}>
                  <option value="">—</option>
                  {it.options.map((o) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
                </select>
              </div>
            )}

            {(t === "check" || t === "boolean") && (
              <div className="field">
                <label>Conformité</label>
                <select className="input" value={results[field] ?? ""} onChange={(e) => onChange(field, e.target.value)}>
                  <option value="">—</option>
                  <option value="conforme">Conforme</option>
                  <option value="non_conforme">Non conforme</option>
                  <option value="na">Non applicable</option>
                </select>
              </div>
            )}

            {(!["number","select","checklist","check","boolean"].includes(t)) && (
              <div className="field">
                <label>Observation</label>
                <input
                  className="input"
                  value={results[field] ?? ""}
                  onChange={(e) => onChange(field, e.target.value)}
                  placeholder="Renseigner le résultat"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function normalizeType(t) {
  if (!t) return "text";
  const k = String(t).toLowerCase();
  if (["boolean", "bool", "check"].includes(k)) return "check";
  if (["number", "numeric", "float", "int"].includes(k)) return "number";
  if (["text", "string"].includes(k)) return "text";
  if (["select", "choice", "enum"].includes(k)) return "select";
  if (["checklist", "list"].includes(k)) return "checklist";
  return k;
}

/* ============================
   Calendar
============================ */
function CalendarPanel({ site, onSelectTask }) {
  const [month, setMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const from = toISODate(month);
        const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
        const rows = await CONTROLS_API.calendar(site, { from, to });
        setItems(rows || []);
      } catch (e) {
        setErr(e.message || String(e));
      }
    })();
  }, [month, site]);

  function prev() {
    const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d);
  }
  function next() {
    const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d);
  }

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
                    {ev.entity_name} · {ev.task_name}
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
          <Icon.Paperclip /> <span className="name">{a.filename}</span>
          <span className="meta">{a.mimetype || "—"} • {a.size ?? "?"} o</span>
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
.rule { font-size: 12px; color:#1f2937; background:#f3f4f6; border:1px dashed var(--border); padding:8px; border-radius:8px; margin-bottom:8px; }
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
@keyframes sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.toasts { position: fixed; right: 16px; bottom: 16px; display:flex; flex-direction:column; gap:8px; z-index: 60; }
.toast { background:#111; color:#fff; padding:10px 12px; border-radius:10px; box-shadow:0 6px 18px rgba(0,0,0,.2); max-width: 70vw; }

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

/* ============================
   FIN
============================ */
