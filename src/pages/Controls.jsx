// src/pages/Controls.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Controls.jsx — full UI, mobile-first, no external UI lib
 * - Fetches library/tasks/tree from backend instead of importing tsd_library.js
 * - Collapsible filters + search
 * - Task list with status chips and icons
 * - Detail panel with:
 *    • "Photo pré-intervention" (obligatoire avant démarrer)
 *    • Uploader multiples (caméra smartphone acceptée)
 *    • Interprétation IA et analyse IA
 *    • Form dynamique selon result_schema (number/text/select/checklist/boolean)
 * - Complete task -> POST /complete
 * - Inputs: fond blanc & texte noir
 *
 * Env:
 *  - Optionnel: VITE_CONTROLS_URL (ex: https://api.example.com)
 *  - Header X-Site stocké en localStorage("controls.site") (Default sinon)
 */

const API_BASE = import.meta.env.VITE_CONTROLS_URL || ""; // same-origin by default
const defaultSite = localStorage.getItem("controls.site") || "Default";

// ------------------------------ SVG Icons (no deps) ------------------------------
const Icon = {
  Filter: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M3 5h18M6 12h12M10 19h4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
  ),
  Search: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
  ),
  Refresh: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M20 6v6h-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M20 12a8 8 0 1 1-2.34-5.66L20 6" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  Camera: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M3 7h4l2-2h6l2 2h4v12H3z" stroke="currentColor" strokeWidth="2" fill="none"/><circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  Upload: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M12 16V4M8 8l4-4 4 4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  Trash: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
  ),
  Calendar: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><rect x="3" y="5" width="18" height="16" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M16 3v4M8 3v4M3 11h18" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  Bolt: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M13 2L3 14h7l-1 8 10-12h-7z" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  Check: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
  ),
  Alert: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
  X: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
  ),
  Wand: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}><path d="M15 4l5 5M2 20l7-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><rect x="14" y="3" width="4" height="4" transform="rotate(45 16 5)" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
  ),
};

// ------------------------------ Small UI helpers ------------------------------
const Pill = ({ children, color = "#111", bg = "#eee", title }) => (
  <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: bg, color, fontWeight: 600, fontSize: 12 }}>
    {children}
  </span>
);

const StatusPill = ({ status }) => {
  const s = (status || "").toLowerCase();
  if (s === "overdue") return <Pill bg="#fde2e2" color="#b40000" title="En retard"><Icon.Alert />Overdue</Pill>;
  if (s === "completed") return <Pill bg="#e7f6ea" color="#106b21" title="Terminé"><Icon.Check />Completed</Pill>;
  return <Pill bg="#e8f0fe" color="#1a56db" title="Planifié"><Icon.Calendar />Planned</Pill>;
};

const Collapsible = ({ label, icon, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible">
      <button className="collapsible-btn" onClick={() => setOpen((o) => !o)}>
        {icon} <span style={{ fontWeight: 700 }}>{label}</span>
        <span className={`chev ${open ? "up" : ""}`}>▾</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
};

// ------------------------------ API layer ------------------------------
async function api(path, { method = "GET", body, site = defaultSite, signal } = {}) {
  const headers = { "Content-Type": "application/json", "X-Site": site };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiUpload(path, files, { label, site = defaultSite, onProgress } = {}) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (label) form.append("label", label);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "X-Site": site },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Upload HTTP ${res.status}`);
  }
  return res.json();
}

// ------------------------------ Uploader ------------------------------
function PhotoUploader({ taskId, label = "during", onDone, disabled }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      setBusy(true);
      await apiUpload(`/api/controls/tasks/${taskId}/upload`, files, { label });
      onDone && onDone();
    } catch (e) {
      alert("Upload: " + e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <label className="btn secondary" style={{ opacity: disabled ? 0.5 : 1 }}>
      <Icon.Upload />
      {label === "pre" ? "Ajouter photo pré-intervention" : "Ajouter des photos"}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={label !== "pre"} // for "pre" we usually want a simple single photo, but multiple is fine too; keep single for clarity
        capture="environment"
        onChange={onPick}
        disabled={busy || disabled}
        style={{ display: "none" }}
      />
    </label>
  );
}

function AttachmentList({ attachments = [], onDelete }) {
  const groups = useMemo(() => {
    const g = { pre: [], during: [], other: [] };
    for (const a of attachments) {
      const key = (a.label || "").toLowerCase();
      if (key === "pre") g.pre.push(a);
      else if (key === "during") g.during.push(a);
      else g.other.push(a);
    }
    return g;
  }, [attachments]);

  const Group = ({ title, items }) =>
    items.length ? (
      <div>
        <div className="section-title">{title}</div>
        <div className="attachments">
          {items.map((att) => (
            <div key={att.id} className="att">
              <a className="thumb" href={`${API_BASE}/api/controls/tasks/${att.task_id || ""}/attachments/${att.id}`} target="_blank" rel="noreferrer">
                {/* If API returns image, browser will preview it in a new tab */}
                <span className="file">{att.filename}</span>
              </a>
              <div className="att-meta">
                <small>{Math.round((att.size || 0) / 1024)} KB</small>
                {onDelete && (
                  <button className="icon-btn danger" title="Supprimer" onClick={() => onDelete(att.id)}>
                    <Icon.Trash />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <>
      <Group title="Pré-intervention" items={groups.pre} />
      <Group title="Pendant l'intervention" items={groups.during} />
      <Group title="Autres" items={groups.other} />
    </>
  );
}

// ------------------------------ Result Form ------------------------------
function ResultForm({ schema, value, onChange }) {
  // schema: { field, type, unit, comparator, threshold, options }
  const [local, setLocal] = useState(() => value || {});
  useEffect(() => setLocal(value || {}), [value]);

  const inputStyle = { background: "#fff", color: "#000", border: "1px solid #ccc", borderRadius: 8, padding: "10px 12px", width: "100%" };

  const setVal = (k, v) => {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange && onChange(next);
  };

  return (
    <div className="grid2">
      {schema?.type === "number" && (
        <>
          <div>
            <label className="lbl">Mesure ({schema.unit || "-"})</label>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={local.value ?? ""}
              placeholder={`ex: seuil ${schema.comparator || "<="} ${schema.threshold ?? "?"} ${schema.unit || ""}`}
              onChange={(e) => setVal("value", e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="lbl">Conforme ?</label>
            <select style={inputStyle} value={local.ok ?? ""} onChange={(e) => setVal("ok", e.target.value === "" ? "" : e.target.value === "true")}>
              <option value="">—</option>
              <option value="true">Oui</option>
              <option value="false">Non</option>
            </select>
          </div>
        </>
      )}

      {schema?.type === "boolean" && (
        <div>
          <label className="lbl">{schema.field || "État"}</label>
          <select style={inputStyle} value={local.ok ?? ""} onChange={(e) => setVal("ok", e.target.value === "" ? "" : e.target.value === "true")}>
            <option value="">—</option>
            <option value="true">Oui</option>
            <option value="false">Non</option>
          </select>
        </div>
      )}

      {schema?.type === "text" && (
        <div>
          <label className="lbl">{schema.field || "Valeur"}</label>
          <input style={inputStyle} type="text" value={local.text ?? ""} onChange={(e) => setVal("text", e.target.value)} />
        </div>
      )}

      {schema?.type === "select" && Array.isArray(schema.options) && (
        <div>
          <label className="lbl">{schema.field || "Sélection"}</label>
          <select style={inputStyle} value={local.choice ?? ""} onChange={(e) => setVal("choice", e.target.value)}>
            <option value="">—</option>
            {schema.options.map((opt) => (
              <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
            ))}
          </select>
        </div>
      )}

      {schema?.type === "checklist" && Array.isArray(schema.options) && (
        <div className="checklist">
          <div className="lbl" style={{ marginBottom: 8 }}>{schema.field || "Checklist"}</div>
          {schema.options.map((opt) => {
            const checked = !!(local.checklist?.[opt]);
            return (
              <label key={String(opt)} className="check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = { ...(local.checklist || {}) };
                    next[opt] = e.target.checked;
                    setVal("checklist", next);
                  }}
                />
                <span>{String(opt)}</span>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ gridColumn: "1 / -1" }}>
        <label className="lbl">Notes</label>
        <textarea style={{ ...inputStyle, minHeight: 80 }} value={local.notes ?? ""} onChange={(e) => setVal("notes", e.target.value)} placeholder="Observations, n° de série des appareils utilisés, etc." />
      </div>
    </div>
  );
}

// ------------------------------ Main Page ------------------------------
export default function Controls() {
  const [site, setSite] = useState(defaultSite);
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState(null); // { types, library }
  const [tree, setTree] = useState([]); // for building filters
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(200);
  const [filters, setFilters] = useState({ building: "", type: "", status: "", q: "" });
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [resultDraft, setResultDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");

  const abortRef = useRef();

  // Load library + tree initially
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        const [lib, t] = await Promise.all([
          api(`/api/controls/library`, { site }),
          api(`/api/controls/tree`, { site }),
        ]);
        if (aborted) return;
        setLibrary(lib);
        setTree(t || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [site]);

  // Load tasks each time filters/page change
  const refreshTasks = async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setLoading(true);
      setError("");
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const k of ["building", "type", "status", "q"]) {
        if (filters[k]) qs.set(k, filters[k]);
      }
      const res = await api(`/api/controls/tasks?${qs.toString()}`, { site, signal: ctrl.signal });
      setTasks(res?.data || []);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refreshTasks(); /* eslint-disable-next-line */ }, [site, page, pageSize, JSON.stringify(filters)]);

  const buildings = useMemo(() => {
    const set = new Set();
    tree.forEach((b) => set.add(b.building));
    return Array.from(set);
  }, [tree]);

  const openDetails = async (task) => {
    setSelected(task);
    setDetails(null);
    setAttachments([]);
    setResultDraft({});
    setAiAnswer("");
    setAiAnalysis("");
    try {
      const d = await api(`/api/controls/tasks/${task.id}/details`, { site });
      setDetails(d);
      const atts = await api(`/api/controls/tasks/${task.id}/attachments`, { site });
      // enrich each with task_id for download link building
      setAttachments((atts || []).map((x) => ({ ...x, task_id: task.id })));
      // start draft with previous results if any
      if (d?.results) setResultDraft(d.results);
    } catch (e) {
      alert("Chargement des détails: " + e.message);
    }
  };

  const deleteAttachment = async (attId) => {
    if (!selected) return;
    if (!confirm("Supprimer cette pièce jointe ?")) return;
    try {
      await fetch(`${API_BASE}/api/controls/tasks/${selected.id}/attachments/${attId}`, { method: "DELETE", headers: { "X-Site": site } });
      const atts = await api(`/api/controls/tasks/${selected.id}/attachments`, { site });
      setAttachments((atts || []).map((x) => ({ ...x, task_id: selected.id })));
    } catch (e) {
      alert("Suppression: " + e.message);
    }
  };

  const askAssistant = async (question) => {
    if (!selected) return;
    try {
      setBusy(true);
      const res = await api(`/api/controls/tasks/${selected.id}/assistant`, { method: "POST", body: { question }, site });
      setAiAnswer(res?.answer || "");
    } catch (e) {
      alert("Assistant IA: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    if (!selected) return;
    try {
      setBusy(true);
      const res = await api(`/api/controls/tasks/${selected.id}/analyze`, { method: "POST", body: {}, site });
      setAiAnalysis(res?.analysis || "");
    } catch (e) {
      alert("Analyse IA: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const ensurePrePhoto = useMemo(() => {
    return attachments.some((a) => (a.label || "").toLowerCase() === "pre");
  }, [attachments]);

  const onComplete = async () => {
    if (!selected || !details) return;
    if (!ensurePrePhoto) {
      alert("Merci d'ajouter au moins 1 photo pré-intervention avant de terminer.");
      return;
    }
    try {
      setBusy(true);
      await api(`/api/controls/tasks/${selected.id}/complete`, {
        method: "POST",
        site,
        body: { results: resultDraft, user: "tech", ai_risk_score: null },
      });
      await refreshTasks();
      alert("Contrôle enregistré ✅");
      setSelected(null);
    } catch (e) {
      alert("Enregistrement: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetFilters = () => setFilters({ building: "", type: "", status: "", q: "" });

  // Persist site
  useEffect(() => {
    localStorage.setItem("controls.site", site);
  }, [site]);

  const headerRight = (
    <div className="right-actions">
      <button className="icon-btn" title="Rafraîchir" onClick={refreshTasks}><Icon.Refresh /></button>
    </div>
  );

  return (
    <div className="controlsPage">
      <style>{CSS}</style>

      <header className="topbar">
        <div className="brand">
          <Icon.Bolt style={{ marginRight: 8 }} />
          <span>Contrôles</span>
        </div>

        <div className="site">
          <label>Site</label>
          <input
            className="site-input"
            style={{ background: "#fff", color: "#000" }}
            value={site}
            onChange={(e) => setSite(e.target.value || "Default")}
            placeholder="Default"
          />
        </div>

        {headerRight}
      </header>

      <section className="filters">
        <Collapsible
          label="Filtres & recherche"
          icon={<Icon.Filter />}
          defaultOpen={false}
        >
          <div className="filters-grid">
            <div>
              <label className="lbl">Bâtiment</label>
              <select
                value={filters.building}
                onChange={(e) => setFilters((f) => ({ ...f, building: e.target.value }))}
                style={inputBase}
              >
                <option value="">Tous</option>
                {buildings.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl">Type d’équipement</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
                style={inputBase}
              >
                <option value="">Tous</option>
                {(library?.types || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl">Statut</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                style={inputBase}
              >
                <option value="">Tous</option>
                <option value="Planned">Planned</option>
                <option value="Overdue">Overdue</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div className="searchbox">
              <label className="lbl">Recherche</label>
              <div className="search">
                <Icon.Search />
                <input
                  style={{ ...inputBase, border: "none", outline: "none" }}
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Nom de tâche, code…"
                />
              </div>
            </div>
            <div className="flt-actions">
              <button className="btn light" onClick={resetFilters}>Réinitialiser</button>
              <button className="btn" onClick={refreshTasks}><Icon.Filter /> Appliquer</button>
            </div>
          </div>
        </Collapsible>
      </section>

      {!!error && <div className="error">Erreur: {error}</div>}

      <section className="list">
        {loading ? (
          <div className="loading">Chargement…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">Aucune tâche</div>
        ) : (
          <div className="cards">
            {tasks.map((t) => (
              <article key={t.id} className="card" onClick={() => openDetails(t)}>
                <div className="card-hd">
                  <div className="title">{t.task_name}</div>
                  <StatusPill status={t.status} />
                </div>
                <div className="meta">
                  <div className="meta-row"><Icon.Bolt /> <span>{t.equipment_type || "—"}</span></div>
                  <div className="meta-row"><Icon.Calendar /> <span>Prochain: {t.next_control || "—"}</span></div>
                  <div className="meta-row"><span>Bat. {t.building || "—"}</span></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selected && details && (
        <div className="drawer">
          <div className="drawer-inner">
            <div className="drawer-hd">
              <div>
                <div className="path">Bat. {details.building || "—"} • {details.task_code}</div>
                <div className="h1">{details.task_name}</div>
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)}><Icon.X /></button>
            </div>

            <div className="drawer-content">
              <div className="panel">
                <div className="section-title">1) Photo pré-intervention (obligatoire)</div>
                <div className="row gap">
                  <PhotoUploader
                    taskId={selected.id}
                    label="pre"
                    onDone={async () => {
                      const atts = await api(`/api/controls/tasks/${selected.id}/attachments`, { site });
                      setAttachments((atts || []).map((x) => ({ ...x, task_id: selected.id })));
                    }}
                  />
                  {!ensurePrePhoto && <Pill bg="#fff4d6" color="#8a6100"><Icon.Alert /> Requis avant démarrer</Pill>}
                  {ensurePrePhoto && <Pill bg="#e7f6ea" color="#106b21"><Icon.Check /> OK</Pill>}
                </div>
              </div>

              <div className="panel">
                <div className="section-title">2) Consignes IA / Procédure</div>
                <div className="ai-actions">
                  <button className="btn secondary" onClick={() => askAssistant("Décris précisément où intervenir, quelles étapes suivre, quels EPI et outils utiliser en te basant sur la TSD et le contexte. Puis liste les points clés à photographier.")}>
                    <Icon.Wand /> Demander les consignes (IA)
                  </button>
                  <button className="btn light" onClick={runAnalysis} title="Analyse des écarts & actions">
                    <Icon.Wand /> Analyser la tâche (IA)
                  </button>
                </div>
                {!!aiAnswer && <div className="ai-box" dangerouslySetInnerHTML={{ __html: mdToHtml(aiAnswer) }} />}
                {!!aiAnalysis && <div className="ai-box" dangerouslySetInnerHTML={{ __html: mdToHtml(aiAnalysis) }} />}
                {details?.tsd_item && (
                  <div className="tsd">
                    <div className="k">TSD</div>
                    <div className="v">
                      <div><b>{details.tsd_item.label}</b></div>
                      <div>Champ: {details.tsd_item.field} • Type: {details.tsd_item.type} {details.tsd_item.unit ? `(${details.tsd_item.unit})` : ""}</div>
                      {details.tsd_item.threshold != null && (
                        <div>Seuil: {details.tsd_item.comparator || "≤"} {details.tsd_item.threshold} {details.tsd_item.unit || ""}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="section-title">3) Saisie des résultats</div>
                <ResultForm schema={details.result_schema} value={resultDraft} onChange={setResultDraft} />
              </div>

              <div className="panel">
                <div className="section-title">4) Pièces jointes (pendant l’intervention)</div>
                <div className="row gap">
                  <PhotoUploader
                    taskId={selected.id}
                    label="during"
                    onDone={async () => {
                      const atts = await api(`/api/controls/tasks/${selected.id}/attachments`, { site });
                      setAttachments((atts || []).map((x) => ({ ...x, task_id: selected.id })));
                    }}
                  />
                </div>
                <AttachmentList attachments={attachments} onDelete={(id) => deleteAttachment(id)} />
              </div>
            </div>

            <div className="drawer-ft">
              <div className="left">
                <StatusPill status={details.status} />
                <small style={{ opacity: 0.7, marginLeft: 10 }}>
                  Prochain: {details.next_control || "—"} • Dernier: {details.last_control || "—"}
                </small>
              </div>
              <div className="right">
                <button className="btn light" onClick={() => setSelected(null)}>Annuler</button>
                <button className="btn" disabled={!ensurePrePhoto || busy} onClick={onComplete}><Icon.Check /> Terminer le contrôle</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------ Styles (scoped) ------------------------------
const inputBase = {
  background: "#fff",
  color: "#000",
  border: "1px solid #ccc",
  borderRadius: 10,
  padding: "10px 12px",
  width: "100%",
};

const CSS = `
.controlsPage { --bg:#0c0f14; --card:#121721; --muted:#95a1b2; --accent:#2563eb; --text:#e8eef9; background:var(--bg); color:var(--text); min-height:100vh; }
.topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; position:sticky; top:0; z-index:10; background:linear-gradient(180deg, rgba(12,15,20,.98), rgba(12,15,20,.8)); border-bottom:1px solid rgba(255,255,255,.08); }
.brand { display:flex; align-items:center; font-weight:800; letter-spacing:.5px; }
.brand svg { color:#ffd166; }
.site { display:flex; align-items:center; gap:8px; }
.site label { font-size:12px; opacity:.8; }
.site-input { width:150px; border-radius:10px; border:1px solid #2a3444; padding:8px 10px; }

.right-actions .icon-btn { background:#1a2233; border:1px solid #2d3a52; color:#dbe6ff; }

.filters { padding:12px 12px 0; }
.collapsible { background:transparent; border:1px solid rgba(255,255,255,.08); border-radius:14px; overflow:hidden; }
.collapsible-btn { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; background:#111624; border:none; color:#dfe8ff; padding:12px 14px; font-size:14px; cursor:pointer; }
.collapsible-btn svg { margin-right:8px; }
.collapsible-btn .chev { transition: transform .2s; opacity:.7; }
.collapsible-btn .chev.up { transform: rotate(180deg); }
.collapsible-body { padding:12px; background:#0c121f; }

.filters-grid { display:grid; grid-template-columns: repeat(12, 1fr); gap:12px; align-items:end; }
.filters-grid > div { grid-column: span 12; }
@media (min-width: 720px) {
  .filters-grid > div { grid-column: span 3; }
  .filters-grid .searchbox { grid-column: span 6; }
  .filters-grid .flt-actions { grid-column: span 12; display:flex; gap:10px; justify-content:flex-end; }
}
.search { display:flex; align-items:center; gap:8px; border:1px solid #2a3444; background:#0c1424; padding:8px 10px; border-radius:10px; }
.search input { background:transparent; color:#fff; }

.btn { display:inline-flex; align-items:center; gap:8px; padding:10px 14px; border-radius:12px; border:1px solid #2a3444; background:var(--accent); color:#fff; font-weight:700; cursor:pointer; }
.btn.secondary { background:#1b2538; color:#dfe8ff; }
.btn.light { background:#0d1321; color:#dfe8ff; }
.btn.danger { background:#8a1f1f; color:#fff; border-color:#a92727; }
.btn:disabled { opacity:.6; cursor:not-allowed; }
.icon-btn { display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; border:1px solid #2a3444; background:#0e1628; color:#cfe0ff; cursor:pointer; }
.icon-btn.danger { background:#2b1414; color:#ffdede; border-color:#4a1a1a; }

.lbl { font-size:12px; color:var(--muted); margin-bottom:6px; display:block; }
.section-title { font-weight:800; margin-bottom:8px; color:#eaf1ff; }
.grid2 { display:grid; grid-template-columns: 1fr; gap:12px; }
@media (min-width: 720px){ .grid2 { grid-template-columns: 1fr 1fr; } }
.checklist .check { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.checklist input { width:18px; height:18px; }

.error { margin:14px 12px; color:#ffb4b4; }
.loading, .empty { opacity:.8; padding:20px 12px; }

.list { padding:12px; }
.cards { display:grid; grid-template-columns: 1fr; gap:12px; }
@media (min-width: 900px){ .cards { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1200px){ .cards { grid-template-columns: repeat(3, 1fr); } }
.card { background:var(--card); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:12px; cursor:pointer; transition: transform .1s, box-shadow .1s; }
.card:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(0,0,0,.2); }
.card-hd { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.card .title { font-weight:800; line-height:1.2; }
.meta { margin-top:8px; display:flex; gap:16px; flex-wrap:wrap; opacity:.9; }
.meta-row { display:flex; align-items:center; gap:8px; }

.attachments { display:grid; grid-template-columns: 1fr; gap:10px; margin-top:10px; }
@media (min-width: 680px){ .attachments { grid-template-columns: repeat(2, 1fr); } }
.att { border:1px solid #2a3444; border-radius:12px; padding:10px; background:#0b1322; display:flex; align-items:center; justify-content:space-between; gap:10px; }
.att .thumb { color:#cfe0ff; text-decoration:none; }
.att .file { display:inline-block; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.att-meta { display:flex; align-items:center; gap:8px; }

.row.gap { display:flex; gap:10px; flex-wrap:wrap; }

.drawer { position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; }
.drawer-inner { margin-left:auto; max-width:960px; width:100%; height:100%; background:#0a0f19; border-left:1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; }
.drawer-hd { display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
.drawer-hd .path { font-size:12px; color:var(--muted); }
.drawer-hd .h1 { font-size:18px; font-weight:800; }
.drawer-content { padding:12px; overflow:auto; display:flex; flex-direction:column; gap:12px; }
.panel { background:#0b1324; border:1px solid #1f2a40; border-radius:14px; padding:12px; }
.tsd { display:grid; grid-template-columns: 80px 1fr; gap:8px; margin-top:10px; background:#0c1528; border:1px dashed #2a3b5a; border-radius:12px; padding:10px; }
.tsd .k { color:#a4b1c6; }
.tsd .v { color:#eaf1ff; }
.ai-actions { display:flex; gap:8px; flex-wrap:wrap; }
.ai-box { margin-top:10px; background:#0e1830; border:1px solid #243456; border-radius:12px; padding:12px; color:#eaf1ff; }
.drawer-ft { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border-top:1px solid rgba(255,255,255,.08); background:rgba(10,15,25,.9); position:sticky; bottom:0; }
`;

// ------------------------------ Utilities ------------------------------
function mdToHtml(md) {
  // Minimal markdown -> HTML for bullets/headers/strong/emphasis/inline code
  if (!md) return "";
  let html = md
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^\- (.*)$/gm, "<li>$1</li>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
  html = html.replace(/(<li>.*<\/li>)/gs, (m) => `<ul>${m}</ul>`);
  html = html.replace(/\n/g, "<br/>");
  return html;
}
