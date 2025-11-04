// src/pages/Oibt.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { api, API_BASE } from "../lib/api.js";
import {
  Folder, FileText, CalendarClock, Download, Trash2, BarChart3,
  AlertTriangle, CheckCircle2, XCircle, ChevronDown, UploadCloud, Filter, Paperclip, Plus, Home, Building2
} from "lucide-react";

/* ----------------------------- UI HELPERS ----------------------------- */
const clsInput = () =>
  "w-full bg-white text-gray-900 placeholder-gray-400 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const btnPrimary = () => "px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700";
const btn = () => "px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90";

const Badge = ({ ok, label, className = "" }) => (
  <span
    className={
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded " +
      (ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700") +
      " " + className
    }
    title={ok ? "Fichier présent" : "Aucune pièce jointe"}
  >
    {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {label}
  </span>
);

const Progress = ({ value }) => (
  <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
    <div className="h-2 bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

const Toast = ({ msg, type, onClose }) => {
  if (!msg) return null;
  const colors = { success: "bg-green-600", error: "bg-red-600", info: "bg-blue-600", warn: "bg-amber-500" };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${colors[type] || colors.info}`}>
      <div className="flex items-center gap-3">
        <span dangerouslySetInnerHTML={{ __html: msg }} />
        <button onClick={onClose} className="bg-white/20 rounded px-2 py-0.5">OK</button>
      </div>
    </div>
  );
};

const ConfirmModal = ({ open, title, message, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        </div>
        <div className="p-6 text-gray-700">{message}</div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onCancel} className="px-3 py-2 rounded bg-gray-200 text-gray-800">Annuler</button>
          <button onClick={onConfirm} className="px-3 py-2 rounded bg-red-600 text-white">Confirmer</button>
        </div>
      </div>
    </div>
  );
};

/* --------------------------- DRAG & DROP INPUT --------------------------- */
function DropInput({ label = "Glissez-déposez ou cliquez pour choisir", multiple = false, onFiles, accept }) {
  const [drag, setDrag] = useState(false);
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDrag(true); };
  const onDragLeave = () => setDrag(false);
  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  };
  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onFiles(files);
  };
  return (
    <label
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex-1 min-w-[240px] cursor-pointer border-2 rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${drag ? "border-blue-500 bg-blue-50" : "border-dashed border-gray-300 bg-white"}`}
      title="Glisser-déposer vos fichiers ici"
    >
      <UploadCloud />
      <span className="text-gray-700">{label}</span>
      <input type="file" className="hidden" multiple={multiple} accept={accept} onChange={onPick} />
    </label>
  );
}

/* --------------------------- RESPONSIVE TABS --------------------------- */
function Tabs({ tabs, active, onChange }) {
  const onKeyDown = useCallback(
    (e) => {
      const idx = tabs.findIndex(t => t.id === active);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = tabs[(idx + 1) % tabs.length];
        onChange(next.id);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        onChange(prev.id);
      }
    },
    [active, onChange, tabs]
  );

  return (
    <div className="relative -mx-4 px-4 md:mx-0 md:px-0">
      <div
        role="tablist"
        aria-label="Onglets OIBT"
        className="mb-6 flex gap-2 overflow-x-auto border-b pb-1"
        onKeyDown={onKeyDown}
        style={{ scrollSnapType: "x mandatory" }}
      >
        {tabs.map(t => {
          const isActive = active === t.id;
          return (
            <button
              id={`tab-${t.id}`}
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${t.id}`}
              onClick={() => onChange(t.id)}
              className={`px-4 py-2 -mb-px border-b-2 min-w-max scroll-snap-align-start ${
                isActive ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600"
              }`}
              title={t.label}
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                {"count" in t ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${isActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                    {t.count}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ DATE HELPERS ------------------------------ */
function toFR(d) {
  try { return d.toLocaleDateString("fr-FR"); } catch { return ""; }
}
function toFRdt(d) {
  try { return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; }
}
function parseFR(dateStr) { // "dd/mm/yyyy" -> Date
  if (!dateStr) return null;
  const [d,m,y] = dateStr.split("/").map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m-1, d);
}
function addMonths(date, delta) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d;
}

/* ------------------------------ PAGE OIBT ------------------------------ */
export default function Oibt() {
  const [tab, setTab] = useState("projects"); // projects | periodics | analysis

  // Projets
  const [projects, setProjects] = useState([]);
  const [qProj, setQProj] = useState("");
  const [title, setTitle] = useState("");
  const [yearFilterProjects, setYearFilterProjects] = useState("all");
  const [statusFilterProjects, setStatusFilterProjects] = useState("all");
  const [expandedProjects, setExpandedProjects] = useState(new Set()); // ids expand

  // Périodiques
  const [periodics, setPeriodics] = useState([]);
  const [qBuild, setQBuild] = useState("");
  const [building, setBuilding] = useState("");
  const [fileReport, setFileReport] = useState(null);
  const [yearFilterPeriodics, setYearFilterPeriodics] = useState("all");
  const [statusFilterPeriodics, setStatusFilterPeriodics] = useState("all");
  const [expandedPeriodics, setExpandedPeriodics] = useState(new Set());

  // Contrôles à venir
  const [upcoming, setUpcoming] = useState([]);

  // Stocke les rapports initiaux sélectionnés pour chaque bâtiment
  const [fileReportsNew, setFileReportsNew] = useState({});

  const [loadingUpcoming, setLoadingUpcoming] = useState(false);

  // UI
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, id: null });

  // Files cache (pour lister TOUTES les pièces jointes)
  const [projFiles, setProjFiles] = useState({});   // key = `${id}:${action}` -> [{id, original_name, uploaded_at, size, mime}]
  const [perFiles, setPerFiles]   = useState({});   // key = `${id}:${type}`

  // Eviter boucles d'auto-correction due
  const fixedDueIdsRef = useRef(new Set());

  useEffect(() => {
    refreshAll();
    refreshUpcoming();
    refreshBuildings();
  }, []);
  async function refreshAll() {
    try {
      const [pj, per] = await Promise.all([
        api.oibt.listProjects(),
        api.oibt.listPeriodics(),
      ]);
      setProjects(pj?.data || pj || []);
      setPeriodics(per?.data || per || []);
    } catch (e) { setToast({ msg: e.message || "Erreur de chargement", type: "error" }); }
  }

  // --------------------- CHARGEMENT DES CONTRÔLES À VENIR ---------------------
  async function refreshUpcoming() {
    try {
      setLoadingUpcoming(true);
      const res = await api.oibt.listUpcoming();
      setUpcoming(res?.data || []);
    } catch (e) {
      setToast({ msg: e.message || "Erreur de chargement des contrôles à venir", type: "error" });
    } finally {
      setLoadingUpcoming(false);
    }
  }

  // ------------------------- VUE PAR BÂTIMENT -------------------------
  const [buildings, setBuildings] = useState([]);
  const [loadingBuildings, setLoadingBuildings] = useState(false);

  async function refreshBuildings() {
    try {
      setLoadingBuildings(true);
      const res = await api.oibt.listBuildings();
      setBuildings(res?.data || []);
    } catch (e) {
      setToast({ msg: e.message || "Erreur de chargement des bâtiments", type: "error" });
    } finally {
      setLoadingBuildings(false);
    }
  }


  /* ----------------------------- YEAR HELPERS ---------------------------- */
  const getYear = (item) => {
    if (item?.year) return Number(item.year);
    try {
      const d = new Date(item?.created_at || item?.createdAt || Date.now());
      if (!isNaN(d)) return d.getFullYear();
    } catch {}
    return new Date().getFullYear();
  };

  const uniqueProjectYears = useMemo(() => {
    const s = new Set(projects.map(getYear));
    return Array.from(s).sort((a,b)=>b-a);
  }, [projects]);

  const uniquePeriodicYears = useMemo(() => {
    const s = new Set(periodics.map(getYear));
    return Array.from(s).sort((a,b)=>b-a);
  }, [periodics]);

  /* ------------------------------ STATUS HELPERS ------------------------------ */
  const stepByKey = (status, key) => (status || []).find(a => (a.key === key) || (a.name || "").toLowerCase().includes(key));
  const hasSporadic = (p) => !!stepByKey(p.status, "sporadic");
  const ensureSporadicStep = (p) => {
    if (hasSporadic(p)) return p.status;
    const next = [...(p.status||[])];
    next.push({ key: "sporadic", name: "Contrôle sporadique", done: false });
    return next;
  };
  const removeSporadicStep = (p) => (p.status||[]).filter(a => a.key !== "sporadic");

  const isProjectLate = (p) => {
    const reception = stepByKey(p.status, "reception");
    if (!reception?.due || reception.done) return false;
    const [d,m,y] = reception.due.split("/").map(Number);
    const due = new Date(y, m-1, d);
    return due < new Date();
  };
  const isProjectDone = (p) => (p.status || []).every(a => !!a.done);
  const isProjectInProgress = (p) => !isProjectDone(p);
  const missingAvis = (p) => !(p.attachments?.avis);

  const periodicDone = (c) => !!(c.report_received && c.defect_report_received && c.confirmation_received);

  /* -------------------------- RAPPORT DATE (PROJETS) -------------------------- */
  function getRapportDate(p) {
    const iso = p?.last_uploads?.rapport;
    if (iso) {
      const d = new Date(iso);
      if (!isNaN(d)) return toFR(d);
    }
    const rec = stepByKey(p.status, "reception");
    if (rec?.due) {
      const due = parseFR(rec.due);
      if (due) return toFR(addMonths(due, -6));
    }
    return null;
  }
  function getRapportDateObj(p) {
    const iso = p?.last_uploads?.rapport;
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d) ? null : d;
  }

  /* ---------------------- AUTO DUE @75% (backfill persistant) ---------------------- */
  const projectProgress = (p) => {
    const n = (p.status || []).length || 1;
    const done = (p.status || []).filter(a => a.done).length;
    return Math.round((done / n) * 100);
  };
  function needsReceptionDue(p) {
    const status = p.status || [];
    const rapport = stepByKey(status, "rapport");
    const reception = stepByKey(status, "reception");
    // 75% typique = 3/4, mais on se base sur la logique métier :
    return !!(rapport?.done && reception && !reception.done && !reception.due);
  }

  useEffect(() => {
    const toFix = projects.filter(p => needsReceptionDue(p) && !fixedDueIdsRef.current.has(p.id));
    if (!toFix.length) return;
    (async () => {
      for (const p of toFix) {
        const status = [...(p.status || [])];
        const recIdx = status.findIndex(a => (a.key === "reception") || a.name === "Contrôle de réception");
        if (recIdx < 0) continue;
        const rapportAt = getRapportDateObj(p);
        const dueDate = toFR(addMonths(rapportAt || new Date(), 6));
        status[recIdx] = { ...status[recIdx], due: dueDate };
        try {
          const upd = await api.oibt.updateProject(p.id, { status, year: p.year ?? getYear(p) });
          fixedDueIdsRef.current.add(p.id);
          setProjects(s => s.map(x => x.id === p.id ? upd : x));
        } catch {
          // on ignore pour ne pas boucler; on réessaiera via refreshAll manuel si besoin
        }
      }
    })();
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------- FILTERED LISTS ---------------------------- */
  const filteredProjects = useMemo(() => {
    const q = qProj.trim().toLowerCase();
    return (projects || [])
      .filter(p => (yearFilterProjects === "all" ? true : getYear(p) === Number(yearFilterProjects)))
      .filter(p => !q ? true : p.title?.toLowerCase().includes(q))
      .filter(p => {
        switch (statusFilterProjects) {
          case "done": return isProjectDone(p);
          case "progress": return isProjectInProgress(p);
          case "late": return isProjectLate(p);
          case "no-avis": return missingAvis(p);
          case "sporadic": return hasSporadic(p) && !stepByKey(p.status, "sporadic")?.done;
          default: return true;
        }
      });
  }, [projects, qProj, yearFilterProjects, statusFilterProjects]);

  const filteredPeriodics = useMemo(() => {
    const q = qBuild.trim().toLowerCase();
    return (periodics || [])
      .filter(c => (yearFilterPeriodics === "all" ? true : getYear(c) === Number(yearFilterPeriodics)))
      .filter(c => !q ? true : c.building?.toLowerCase().includes(q))
      .filter(c => {
        switch (statusFilterPeriodics) {
          case "done": return periodicDone(c);
          case "progress": return !periodicDone(c);
          default: return true;
        }
      });
  }, [periodics, qBuild, yearFilterPeriodics, statusFilterPeriodics]);

  /* ------------------------------ PERIODIC PROGRESS ------------------------------ */
  const periodicProgress = (c) => {
    const flags = [
      c.report_received ? 1 : 0,
      c.defect_report_received ? 1 : 0,
      c.confirmation_received ? 1 : 0,
    ];
    return Math.round((flags.reduce((a, b) => a + b, 0) / 3) * 100);
  };

  /* ------------------------------ ACTIONS ------------------------------ */
  async function createProject() {
    if (!title.trim()) return;
    try {
      const p = await api.oibt.createProject({ title: title.trim() });
      setProjects(s => [p, ...s]);
      setTitle("");
      setToast({ msg: "Projet créé", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  function toggleExpandProject(id) {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleExpandPeriodic(id) {
    setExpandedPeriodics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function toggleAction(projectId, index) {
    const pj = projects.find(p => p.id === projectId);
    if (!pj) return;
    const next = (pj.status || []).map((a, i) => i === index ? { ...a, done: !a.done } : a);
    try {
      const upd = await api.oibt.updateProject(projectId, { status: next, year: pj.year ?? getYear(pj) });
      setProjects(s => s.map(p => p.id === projectId ? upd : p));
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function deleteProject(id) {
    try {
      await api.oibt.removeProject(id);
      setProjects(s => s.filter(p => p.id !== id));
      setToast({ msg: "Projet supprimé", type: "info" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  // UPLOAD PROJET = coche auto (support drag & drop + multiple UI)
  async function uploadProjectFiles(id, action, files) {
    if (!files?.length) return;
    try {
      for (const file of files) {
        const fd = new FormData(); fd.append("file", file);
        await api.oibt.uploadProjectActionFile(id, action, fd);
      }
      setProjects(prev => {
        const pj = prev.find(p => p.id === id);
        if (!pj) return prev;
        const idx = (pj.status || []).findIndex(a => (a.key || "").toLowerCase() === action);
        if (idx < 0) return prev;
        const nextStatus = pj.status.map((a, i) => i === idx ? { ...a, done: true } : a);
        api.oibt.updateProject(id, { status: nextStatus, year: pj.year ?? getYear(pj) }).catch(()=>{});
        return prev.map(p => p.id === id ? { ...p, status: nextStatus } : p);
      });
      setToast({ msg: files.length > 1 ? `${files.length} fichiers ajoutés` : "Fichier ajouté", type: "success" });
      await refreshAll();
      // recharger la liste des fichiers pour cet action si la carte est ouverte
      await loadProjectFiles(id, action, true);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function setProjectYear(id, year) {
    const pj = projects.find(p => p.id === id);
    if (!pj) return;
    try {
      const upd = await api.oibt.updateProject(id, { status: pj.status, year });
      setProjects(s => s.map(p => p.id === id ? upd : p));
      setToast({ msg: "Année du projet mise à jour", type: "success" });
    } catch (e) { setToast({ msg: "Échec mise à jour de l'année", type: "error" }); }
  }

  async function addPeriodic() {
    if (!building.trim()) return;
    try {
      const row = await api.oibt.createPeriodic({ building: building.trim() });
      if (fileReport) {
        const fd = new FormData(); fd.append("file", fileReport);
        const upd = await api.oibt.uploadPeriodicFile(row.id, "report", fd);
        setPeriodics(s => s.map(c => c.id === row.id ? upd : c));
      }
      setBuilding(""); setFileReport(null);
      await refreshAll();
      setToast({ msg: "Contrôle périodique ajouté", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function uploadPeriodic(id, type, files) {
    if (!files?.length) return;
    try {
      for (const file of files) {
        const fd = new FormData(); fd.append("file", file);
        await api.oibt.uploadPeriodicFile(id, type, fd);
      }
      await refreshAll();
      setToast({ msg: files.length > 1 ? `${files.length} fichiers ajoutés` : "Fichier ajouté", type: "success" });
      await loadPeriodicFiles(id, type, true);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function togglePeriodic(row, key) {
    try {
      const body = {
        report_received: key === "report" ? !row.report_received : row.report_received,
        defect_report_received: key === "defect" ? !row.defect_report_received : row.defect_report_received,
        confirmation_received: key === "confirm" ? !row.confirmation_received : row.confirmation_received,
        year: row.year ?? getYear(row),
      };
      const upd = await api.oibt.updatePeriodic(row.id, body);
      setPeriodics(s => s.map(c => c.id === row.id ? upd : c));
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function setPeriodicYear(id, year) {
    const row = periodics.find(p => p.id === id);
    if (!row) return;
    try {
      const upd = await api.oibt.updatePeriodic(id, { year });
      setPeriodics(s => s.map(c => c.id === id ? upd : c));
      setToast({ msg: "Année du périodique mise à jour", type: "success" });
    } catch (e) { setToast({ msg: "Échec mise à jour de l'année", type: "error" }); }
  }

  async function deletePeriodic(id) {
    try {
      await api.oibt.removePeriodic(id);
      setPeriodics(s => s.filter(c => c.id !== id));
      setToast({ msg: "Bâtiment supprimé", type: "info" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  // ---------------------------------------------------------------------------
  //  DUPLIQUER UN CONTRÔLE PÉRIODIQUE (nouvelle année pour un même bâtiment)
  // ---------------------------------------------------------------------------
  async function duplicatePeriodic(base) {
    try {
      // Calcule la prochaine année selon le type de bâtiment
      const currentYear = base.year ?? getYear(base);
      const nextYear = base.building?.toLowerCase().includes("atex") ? currentYear + 3 : currentYear + 5;

      // Crée la nouvelle ligne via l’API
      const newRow = await api.oibt.createPeriodic({
        building: base.building,
        year: nextYear,
      });

      // Recharge la liste
      await refreshAll();
      setToast({ msg: `Nouveau contrôle ${base.building} (${nextYear}) créé`, type: "success" });
    } catch (e) {
      setToast({ msg: e.message || "Erreur lors de la création du nouveau contrôle", type: "error" });
    }
  }

  // Sporadique: besoin = floor(nb projets ouverts / 10)
  const openProjects = useMemo(() => projects.filter(isProjectInProgress), [projects]);
  const sporadNeeded = Math.floor(openProjects.length / 10);
  const sporadAssigned = projects.filter(p => hasSporadic(p) && !stepByKey(p.status, "sporadic")?.done).length;
  const canAssign = sporadAssigned < sporadNeeded;

  async function markProjectSporadic(p, enable) {
    const next = enable ? ensureSporadicStep(p) : removeSporadicStep(p);
    try {
      const upd = await api.oibt.updateProject(p.id, { status: next, year: p.year ?? getYear(p) });
      setProjects(list => list.map(x => x.id === p.id ? upd : x));
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function autoAssignSporadic() {
    if (!canAssign) return;
    const eligible = projects.filter(p => stepByKey(p.status, "reception")?.done && !hasSporadic(p));
    const toPick = Math.max(0, sporadNeeded - sporadAssigned);
    const pick = eligible.sort(() => 0.5 - Math.random()).slice(0, toPick);
    for (const p of pick) {
      await markProjectSporadic(p, true);
    }
    if (pick.length) setToast({ msg: `${pick.length} projet(s) marqués en sporadique`, type: "success" });
  }

  /* ------------------------------ FILE URLS ------------------------------ */
  const projFileUrlLatest = (id, action) => `${API_BASE || ""}/api/oibt/projects/${id}/download?action=${encodeURIComponent(action)}`;
  const perFileUrlLatest  = (id, type)   => `${API_BASE || ""}/api/oibt/periodics/${id}/download?type=${encodeURIComponent(type)}`;
  const projDownloadById  = (fileId)     => `${API_BASE || ""}/api/oibt/projects/download-file?file_id=${encodeURIComponent(fileId)}`;
  const perDownloadById   = (fileId)     => `${API_BASE || ""}/api/oibt/periodics/download-file?file_id=${encodeURIComponent(fileId)}`;

  /* ------------------------------ LIST FILES ------------------------------ */
  async function loadProjectFiles(id, action, force=false) {
    const key = `${id}:${action}`;
    if (!force && projFiles[key]) return;
    try {
      const r = await fetch(`${API_BASE || ""}/api/oibt/projects/${id}/files?action=${encodeURIComponent(action)}`);
      if (!r.ok) throw new Error("files list not available");
      const js = await r.json();
      setProjFiles(prev => ({ ...prev, [key]: js?.files || js || [] }));
    } catch {
      setProjFiles(prev => ({ ...prev, [key]: null })); // pas dispo → fallback lien "dernier fichier"
    }
  }
  async function loadPeriodicFiles(id, type, force=false) {
    const key = `${id}:${type}`;
    if (!force && perFiles[key]) return;
    try {
      const r = await fetch(`${API_BASE || ""}/api/oibt/periodics/${id}/files?type=${encodeURIComponent(type)}`);
      if (!r.ok) throw new Error("files list not available");
      const js = await r.json();
      setPerFiles(prev => ({ ...prev, [key]: js?.files || js || [] }));
    } catch {
      setPerFiles(prev => ({ ...prev, [key]: null }));
    }
  }

  // auto-load à l'ouverture d'une carte
  useEffect(() => {
    for (const p of projects) {
      if (!expandedProjects.has(p.id)) continue;
      const steps = (p.status||[]).map(a => (a.key || "").toLowerCase()).filter(k => k && k !== "sporadic");
      for (const act of steps) loadProjectFiles(p.id, act).catch(()=>{});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProjects, projects.length]);

  useEffect(() => {
    for (const c of periodics) {
      if (!expandedPeriodics.has(c.id)) continue;
      ["report", "defect", "confirmation"].forEach(t => loadPeriodicFiles(c.id, t).catch(()=>{}));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedPeriodics, periodics.length]);

  /* ------------------------------ ALERTES ------------------------------ */
  const alerts = useMemo(() => {
    const out = { project: [], periodic: [] };
    const today = new Date();

    // Projets
    for (const p of projects) {
      const att = p.attachments || {};
      if (!att.avis) {
        out.project.push({ level: "warn", text: `Projet « ${p.title} » — Avis d’installation manquant.` });
      }
      const rec = stepByKey(p.status, "reception");
      if (rec?.due && !rec.done) {
        const [d, m, y] = rec.due.split("/").map(Number);
        const due = new Date(y, m - 1, d);
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        if (diff < 0) out.project.push({ level: "error", text: `Projet « ${p.title} » — Contrôle de réception en retard (dû le ${rec.due}).` });
        else if (diff <= 30) out.project.push({ level: "warn", text: `Projet « ${p.title} » — Réception dans ${diff} jours (dû le ${rec.due}).` });
      }
    }

    // Périodiques (jalons 3/6 mois après rapport)
    for (const c of periodics) {
      if (c.report_received && c.report_received_at) {
        const base = new Date(c.report_received_at);
        const plus3 = new Date(base); plus3.setMonth(plus3.getMonth() + 3);
        const plus6 = new Date(base); plus6.setMonth(plus6.getMonth() + 6);

        if (!c.defect_report_received) {
          if (new Date() > plus6) out.periodic.push({ level: "error", text: `Périodique « ${c.building} » — délai 6 mois dépassé pour l’élimination des défauts.` });
          else if (new Date() > plus3) out.periodic.push({ level: "warn", text: `Périodique « ${c.building} » — dépassement 3 mois, corriger avant 6 mois.` });
        }
      }
    }
    return out;
  }, [projects, periodics]);

  const hasAnyAlert = (alerts.project.length + alerts.periodic.length) > 0;

  const AlertBanner = ({ item }) => {
    const color =
      item.level === "error" ? "bg-rose-100 text-rose-800 border-rose-200" :
      item.level === "warn"  ? "bg-amber-100 text-amber-800 border-amber-200" :
      "bg-blue-100 text-blue-800 border-blue-200";
    const Icon =
      item.level === "error" ? AlertTriangle :
      item.level === "warn"  ? AlertTriangle :
      CalendarClock;
    return (
      <div className={`px-3 py-2 rounded border ${color} flex items-center gap-2`}>
        <Icon size={16} />
        <span className="text-sm">{item.text}</span>
      </div>
    );
  };

  /* -------------------------------- RENDER ------------------------------- */
  const TABS = [
    { id: "projects", label: "Projets", count: filteredProjects.length },
    { id: "periodics", label: "Périodiques", count: filteredPeriodics.length },
    { id: "upcoming", label: "Contrôles à venir", count: upcoming.length },
    { id: "buildings", label: "Vue par bâtiment", count: buildings.length },
    { id: "analysis", label: "Analysis" },
  ];

  // Regroupement des périodiques par bâtiment (⚠️ à placer avant le return)
  const groupedPeriodics = useMemo(() => {
    const map = {};
    for (const c of filteredPeriodics) {
      const name = c.building || "Autres";
      if (!map[name]) map[name] = [];
      map[name].push(c);
    }
    return Object.entries(map);
  }, [filteredPeriodics]);

  // Fonction globale pour ouvrir un contrôle périodique complet depuis d’autres onglets
  useEffect(() => {
    window.openPeriodicDetails = (id) => {
      // Passe à l’onglet périodiques
      setTab("periodics");

      // Déplie automatiquement le contrôle voulu
      setExpandedPeriodics((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Feedback utilisateur
      setToast({
        msg: "Ouverture du contrôle complet…",
        type: "info",
      });
    };

    // Nettoyage quand le composant est démonté
    return () => {
      delete window.openPeriodicDetails;
    };
  }, []);

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      <header className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <BarChart3 /> OIBT – Installation &amp; Contrôles
        </h1>
        <p className="text-gray-600">
          Avis d’installation, protocoles, rapports de sécurité, contrôle de réception,
          contrôles périodiques et contrôle sporadique.
        </p>
      </header>

      {/* Statut global */}
      <div className="mb-4">
        {hasAnyAlert ? (
          <div className="grid gap-2">
            {alerts.project.map((a, i) => (
              <AlertBanner key={`pa-${i}`} item={a} />
            ))}
            {alerts.periodic.map((a, i) => (
              <AlertBanner key={`pe-${i}`} item={a} />
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 rounded border bg-emerald-100 text-emerald-800 border-emerald-200 flex items-center gap-2">
            <CheckCircle2 size={16} />{" "}
            <span className="text-sm">
              Aucune alerte en cours — tout est OK ✅
            </span>
          </div>
        )}
      </div>

      {/* Onglets responsives */}
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ------------------------------ PROJETS ------------------------------ */}
      <div id="panel-projects" role="tabpanel" aria-labelledby="tab-projects" hidden={tab !== "projects"}>
        {tab === "projects" && (
          <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200 mb-8">
            {/* bar filtres */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">Projets</h2>
              <div className="flex gap-2 w-full sm:w-auto items-center">
                <Filter className="text-gray-500 hidden sm:block" />
                <select value={statusFilterProjects} onChange={e=>setStatusFilterProjects(e.target.value)} className={clsInput()} style={{maxWidth:200}}>
                  <option value="all">Statut : Tous</option>
                  <option value="progress">En cours</option>
                  <option value="done">Terminés</option>
                  <option value="late">En retard (réception)</option>
                  <option value="no-avis">Sans avis d’installation</option>
                  <option value="sporadic">Sporadique requis</option>
                </select>
                <select value={yearFilterProjects} onChange={e=>setYearFilterProjects(e.target.value)} className={clsInput()} style={{maxWidth:160}}>
                  <option value="all">Année : Toutes</option>
                  {uniqueProjectYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <input value={qProj} onChange={e => setQProj(e.target.value)} placeholder="Filtrer par titre…" className={clsInput()} />
                <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
              </div>
            </div>

            {/* sporadique helper */}
            <div className="mt-3 p-3 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center justify-between gap-3">
              <div className="text-sm">
                Besoin de <b>{sporadNeeded}</b> projet(s) en <i>contrôle sporadique</i> (5% des {openProjects.length} projets ouverts). Actuellement : <b>{sporadAssigned}</b>.
              </div>
              <div className="flex gap-2">
                <button onClick={autoAssignSporadic} className={`px-3 py-2 rounded ${canAssign ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-500"}`} disabled={!canAssign}>Assigner automatiquement</button>
              </div>
            </div>

            {/* création */}
            <div className="mt-4 flex gap-2 flex-col sm:flex-row">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titre du projet" className={clsInput()} />
              <button onClick={createProject} className={btnPrimary()}>Créer</button>
            </div>

            {/* liste */}
            <div className="mt-5 grid gap-4">
              {filteredProjects.map(p => {
                const progressVal = projectProgress(p);
                const reception = stepByKey(p.status, "reception");
                const late = isProjectLate(p);
                const year = p.year ?? getYear(p);
                const expanded = expandedProjects.has(p.id);
                const done = progressVal === 100;
                const spor = hasSporadic(p);
                const created = p.created_at || p.createdAt;
                const rapportDate = getRapportDate(p);

                return (
                  <div key={p.id} className="p-4 rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {done ? <CheckCircle2 className="text-emerald-600" /> : <Folder className="text-indigo-500" />}
                        <div>
                          <div className="font-medium text-gray-900 flex items-center gap-2">
                            {p.title}
                            {spor && <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Sporadique</span>}
                          </div>
                          <div className="text-xs text-gray-600 flex flex-wrap items-center gap-3">
                            <span>Année&nbsp;
                              <input
                                type="number"
                                value={year}
                                onChange={e => setProjectYear(p.id, Number(e.target.value))}
                                className="w-20 bg-white border border-gray-300 rounded px-2 py-0.5 ml-1"
                              />
                            </span>
                            {!!created && <span className="flex items-center gap-1"><CalendarClock size={14}/> Créé le {toFR(new Date(created))}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* bouton sporadique si réception ok */}
                        <button
                          onClick={() => markProjectSporadic(p, !spor)}
                          className={`px-2 py-1 rounded border ${stepByKey(p.status, "reception")?.done ? "bg-white text-gray-700 hover:bg-gray-50" : "bg-gray-100 text-gray-400"}`}
                          title={stepByKey(p.status, "reception")?.done ? (spor ? "Retirer le contrôle sporadique" : "Marquer pour contrôle sporadique") : "Disponible après la réception"}
                          disabled={!stepByKey(p.status, "reception")?.done}
                        >
                          Sporadique
                        </button>
                        <button
                          onClick={() => toggleExpandProject(p.id)}
                          className="px-2 py-1 rounded border bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                          title={expanded ? "Replier" : "Dérouler"}
                        >
                          <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        <button onClick={() => setConfirm({ open: true, id: p.id })} title="Supprimer" className="text-red-600 hover:text-red-700"><Trash2 /></button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <Progress value={progressVal} />
                      <div className="mt-1 text-xs text-gray-600 flex flex-wrap items-center gap-3">
                        <span>{progressVal}%</span>
                        {rapportDate && (
                          <span className="flex items-center gap-1 text-gray-600">
                            <CalendarClock size={14} /> Rapport de sécurité déposé le {rapportDate}
                          </span>
                        )}
                        {/* N’afficher l’échéance que si la réception n’est PAS terminée */}
                        {reception?.due && !reception?.done && (
                          <span className={`flex items-center gap-1 ${late ? "text-red-600" : "text-gray-600"}`}>
                            <CalendarClock size={14} />
                            Réception avant le {reception.due}
                            {late && <span className="inline-flex items-center gap-1"><AlertTriangle size={14}/>en retard</span>}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Contenu déroulant */}
                    {expanded && (
                      <ul className="mt-3 space-y-3">
                        {(p.status || []).map((a, i) => {
                          const key = a.key || (a.name?.includes("Avis") ? "avis" : a.name?.includes("Protocole") ? "protocole" : a.name?.includes("Rapport") ? "rapport" : a.name?.toLowerCase().includes("sporad") ? "sporadic" : "reception");
                          const showUpload = true;
                          const hasFile = !!p.attachments?.[key];
                          const accept = ".pdf,.doc,.docx,.png,.jpg,.jpeg";
                          const canUploadMulti = key !== "sporadic";
                          const filesKey = `${p.id}:${key}`;
                          const list = projFiles[filesKey];

                          return (
                            <li key={`${p.id}-${i}`} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                              <div className="flex items-center justify-between gap-3">
                                <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap">
                                  <input type="checkbox" checked={!!a.done} onChange={() => toggleAction(p.id, i)} />
                                  <span className="flex items-center gap-2"><FileText className="text-gray-500" /> {a.name}</span>
                                  {a.due && !a.done && <span className="text-xs text-gray-500 flex items-center gap-1"><CalendarClock size={14} /> Échéance {a.due}</span>}
                                </label>
                                {showUpload && <Badge ok={hasFile} label={hasFile ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />}
                              </div>

                              {/* Upload + Downloads */}
                              {showUpload && (
                                <div className="mt-2 flex flex-col gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <DropInput
                                      multiple={canUploadMulti}
                                      accept={accept}
                                      onFiles={(files) => uploadProjectFiles(p.id, key, files)}
                                    />
                                    {hasFile && (
                                      <a href={projFileUrlLatest(p.id, key)} target="_blank" rel="noreferrer"
                                         className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0">
                                        <Download size={16} /> Télécharger le dernier
                                      </a>
                                    )}
                                  </div>

                                  {/* Liste complète des pièces jointes */}
                                  <div className="mt-1">
                                    <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
                                      <Paperclip size={14}/> Pièces jointes {list === undefined ? "(chargement auto…)" : ""}
                                      {list === undefined && (
                                        <button
                                          onClick={() => loadProjectFiles(p.id, key, true)}
                                          className="ml-2 text-blue-600 hover:underline"
                                        >
                                          Recharger
                                        </button>
                                      )}
                                    </div>
                                    {list === null && (
                                      <div className="text-xs text-gray-500">
                                        Listing non disponible côté serveur — seul le dernier fichier est téléchargeable via le lien ci-dessus.
                                      </div>
                                    )}
                                    {Array.isArray(list) && list.length === 0 && (
                                      <div className="text-xs text-gray-500">Aucun fichier.</div>
                                    )}
                                    {Array.isArray(list) && list.length > 0 && (
                                      <ul className="text-sm text-gray-800 flex flex-col gap-1">
                                        {list.map(f => (
                                          <li key={f.id} className="flex items-center gap-2">
                                            <a
                                              href={projDownloadById(f.id)}
                                              className="text-blue-600 hover:underline flex items-center gap-1"
                                              target="_blank" rel="noreferrer"
                                              title={f.original_name}
                                            >
                                              <Download size={16} /> {f.original_name}
                                            </a>
                                            <span className="text-xs text-gray-500">({toFRdt(new Date(f.uploaded_at))})</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
              {filteredProjects.length === 0 && (
                <div className="text-sm text-gray-600">Aucun projet.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------- PÉRIODIQUES ---------------------------- */}
      <div
        id="panel-periodics"
        role="tabpanel"
        aria-labelledby="tab-periodics"
        hidden={tab !== "periodics"}
      >
        {tab === "periodics" && (
          <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
            {/* Barre de filtres et création */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                Contrôles périodiques
              </h2>
              <div className="flex gap-2 w-full sm:w-auto items-center">
                <Filter className="text-gray-500 hidden sm:block" />
                <select
                  value={statusFilterPeriodics}
                  onChange={(e) => setStatusFilterPeriodics(e.target.value)}
                  className={clsInput()}
                  style={{ maxWidth: 180 }}
                >
                  <option value="all">Statut : Tous</option>
                  <option value="progress">En cours</option>
                  <option value="done">Terminés</option>
                </select>
                <select
                  value={yearFilterPeriodics}
                  onChange={(e) => setYearFilterPeriodics(e.target.value)}
                  className={clsInput()}
                  style={{ maxWidth: 160 }}
                >
                  <option value="all">Année : Toutes</option>
                  {uniquePeriodicYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <input
                  value={qBuild}
                  onChange={(e) => setQBuild(e.target.value)}
                  placeholder="Filtrer par bâtiment…"
                  className={clsInput()}
                />
                <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
              </div>
            </div>

            {/* Formulaire création manuelle */}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input
                value={building}
                onChange={e => setBuilding(e.target.value)}
                placeholder="Nom du bâtiment"
                className={clsInput()}
              />
              <DropInput
                label="Glissez-déposez le rapport initial (optionnel)"
                multiple={false}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onFiles={files => setFileReport(files[0] || null)}
              />
              <button onClick={addPeriodic} className={btnPrimary()}>Ajouter</button>
            </div>

            {/* Liste groupée par bâtiment */}
            <div className="mt-4 grid gap-6">
              {groupedPeriodics.map(([buildingName, rows]) => (
                <div
                  key={buildingName}
                  className="border border-gray-200 rounded-xl shadow-sm bg-white overflow-hidden"
                >
                  {/* En-tête de groupe */}
                  <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                    <div className="font-semibold text-gray-900 flex items-center gap-2">
                      <Folder className="text-indigo-600" /> {buildingName}
                    </div>
                    <button
                      onClick={() => duplicatePeriodic(rows[0])}
                      className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                    >
                      + Nouveau contrôle
                    </button>
                  </div>

                  {/* Corps : tous les contrôles de ce bâtiment */}
                  <div className="p-4 grid gap-4">
                    {rows.map(c => {
                      const progress = periodicProgress(c);
                      const year = c.year ?? getYear(c);
                      const expanded = expandedPeriodics.has(c.id);
                      const done = progress === 100;
                      const created = c.created_at || c.createdAt;

                      return (
                        <div
                          key={c.id}
                          className="p-3 rounded-lg border border-gray-200 bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              {done
                                ? <CheckCircle2 className="text-emerald-600" />
                                : <FileText className="text-indigo-500" />}
                              <div>
                                <div className="font-medium text-gray-900">
                                  Année {year}
                                </div>
                                {!!created && (
                                  <div className="text-xs text-gray-600 flex items-center gap-1">
                                    <CalendarClock size={14} /> Créé le {toFR(new Date(created))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleExpandPeriodic(c.id)}
                                className="px-2 py-1 rounded border bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                                title={expanded ? "Replier" : "Dérouler"}
                              >
                                <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                              </button>
                              <button
                                onClick={() => setConfirm({ open: true, id: `per-${c.id}` })}
                                title="Supprimer"
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </div>

                          <div className="mt-3">
                            <Progress value={progress} />
                            <div className="mt-1 text-xs text-gray-600">{progress}%</div>
                          </div>

                          {/* Contenu déroulant */}
                          {expanded && (
                            <div className="mt-3 grid gap-3 lg:grid-cols-3">
                              {/* Rapport */}
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-900">Rapport de contrôle périodique</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={!!c.report_received}
                                      onChange={() => togglePeriodic(c, "report")}
                                    /> Reçu
                                  </label>
                                  <DropInput
                                    multiple
                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                    onFiles={files => uploadPeriodic(c.id, "report", files)}
                                  />
                                  <Badge ok={!!c.has_report} label={c.has_report ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                                  {c.has_report && (
                                    <a
                                      className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                                      href={perFileUrlLatest(c.id, "report")}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Download size={16} /> Télécharger le dernier
                                    </a>
                                  )}
                                </div>
                                <FilesList
                                  list={perFiles[`${c.id}:report`]}
                                  onLoad={() => loadPeriodicFiles(c.id, "report", true)}
                                  makeHref={fid => perDownloadById(fid)}
                                />
                              </div>

                              {/* Défauts */}
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-900">Élimination des défauts</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={!!c.defect_report_received}
                                      onChange={() => togglePeriodic(c, "defect")}
                                    /> Reçus
                                  </label>
                                  <DropInput
                                    multiple
                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                    onFiles={files => uploadPeriodic(c.id, "defect", files)}
                                  />
                                  <Badge ok={!!c.has_defect} label={c.has_defect ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                                  {c.has_defect && (
                                    <a
                                      className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                                      href={perFileUrlLatest(c.id, "defect")}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Download size={16} /> Télécharger le dernier
                                    </a>
                                  )}
                                </div>
                                <FilesList
                                  list={perFiles[`${c.id}:defect`]}
                                  onLoad={() => loadPeriodicFiles(c.id, "defect", true)}
                                  makeHref={fid => perDownloadById(fid)}
                                />
                              </div>

                              {/* Confirmation */}
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-900">Confirmation</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={!!c.confirmation_received}
                                      onChange={() => togglePeriodic(c, "confirm")}
                                    /> Reçue
                                  </label>
                                  <DropInput
                                    multiple
                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                    onFiles={files => uploadPeriodic(c.id, "confirmation", files)}
                                  />
                                  <Badge ok={!!c.has_confirmation} label={c.has_confirmation ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                                  {c.has_confirmation && (
                                    <a
                                      className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                                      href={perFileUrlLatest(c.id, "confirmation")}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Download size={16} /> Télécharger le dernier
                                    </a>
                                  )}
                                </div>
                                <FilesList
                                  list={perFiles[`${c.id}:confirmation`]}
                                  onLoad={() => loadPeriodicFiles(c.id, "confirmation", true)}
                                  makeHref={fid => perDownloadById(fid)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {filteredPeriodics.length === 0 && (
                <div className="text-sm text-gray-600">Aucun contrôle périodique.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* -------------------------- CONTRÔLES À VENIR -------------------------- */}
      <div
        id="panel-upcoming"
        role="tabpanel"
        aria-labelledby="tab-upcoming"
        hidden={tab !== "upcoming"}
      >
        {tab === "upcoming" && (
          <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
            {/* En-tête */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <CalendarClock className="text-blue-600" /> Contrôles périodiques à venir
              </h2>
              <button onClick={refreshUpcoming} className={btn()}>
                Rafraîchir
              </button>
            </div>

            {/* État de chargement */}
            {loadingUpcoming ? (
              <div className="text-gray-500 text-sm italic">
                Chargement des contrôles à venir…
              </div>
            ) : upcoming.length === 0 ? (
              <div className="text-gray-600 text-sm">
                Aucun contrôle prévu pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-100 text-gray-700 text-sm">
                    <tr>
                      <th className="px-3 py-2 text-left">Bâtiment</th>
                      <th className="px-3 py-2 text-left">Dernier contrôle</th>
                      <th className="px-3 py-2 text-left">Prochain à effectuer</th>
                      <th className="px-3 py-2 text-left">Échéance (dans…)</th>
                      <th className="px-3 py-2 text-left">Historique</th>
                      <th className="px-3 py-2 text-left">Dernier rapport</th>
                      <th className="px-3 py-2 text-left">Créer / Rapport initial</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100 text-sm">
                    {upcoming.map((b, i) => (
                      <tr
                        key={b.id || i}
                        className="hover:bg-blue-50 transition-colors align-top"
                      >
                        {/* Bâtiment */}
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {b.building}
                        </td>

                        {/* Dernier contrôle */}
                        <td className="px-3 py-2">
                          {b.last_year || "—"}
                        </td>

                        {/* Prochain contrôle */}
                        <td className="px-3 py-2">{b.next_due_year}</td>

                        {/* Échéance */}
                        <td className="px-3 py-2">
                          {b.next_due_in <= 0 ? (
                            <span className="text-red-600 font-medium">
                              À faire cette année
                            </span>
                          ) : (
                            <span className="text-gray-700">
                              {b.next_due_in} an{b.next_due_in > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>

                        {/* Historique */}
                        <td className="px-3 py-2">
                          <details className="cursor-pointer select-none">
                            <summary className="text-blue-600 hover:underline">
                              Voir
                            </summary>
                            <ul className="pl-4 mt-1 text-gray-600 space-y-0.5">
                              {b.history.map((h, j) => (
                                <li key={j}>
                                  {h.year} — créé le {toFR(new Date(h.created_at))}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>

                        {/* Dernier rapport */}
                        <td className="px-3 py-2">
                          {b.history?.[0]?.id ? (
                            <a
                              href={`${API_BASE}/api/oibt/periodics/${b.history[0].id}/download?type=report`}
                              className="text-blue-600 hover:underline flex items-center gap-1"
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download size={16} /> Télécharger
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* Création directe */}
                        <td className="px-3 py-2 min-w-[260px]">
                          <div className="flex flex-col gap-2">
                            <DropInput
                              label="Rapport initial (optionnel)"
                              multiple={false}
                              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                              onFiles={(files) =>
                                setFileReportsNew((prev) => ({
                                  ...prev,
                                  [b.building]: files[0] || null,
                                }))
                              }
                            />

                            <button
                              onClick={async () => {
                                try {
                                  const payload = {
                                    building: b.building,
                                    year: new Date().getFullYear(),
                                  };
                                  const res = await api.oibt.createPeriodic(payload);
                                  if (res?.id) {
                                    const selectedFile = fileReportsNew[b.building];
                                    if (selectedFile) {
                                      const fd = new FormData();
                                      fd.append("file", selectedFile);
                                      await api.oibt.uploadPeriodicFile(res.id, "report", fd);
                                    }

                                    setToast({
                                      msg: `Nouveau contrôle créé pour ${b.building}`,
                                      type: "success",
                                    });
                                    setFileReportsNew((prev) => ({
                                      ...prev,
                                      [b.building]: null,
                                    }));
                                    await refreshAll();
                                    window.openPeriodicDetails(res.id);
                                  } else {
                                    setToast({
                                      msg: "Création du contrôle échouée.",
                                      type: "error",
                                    });
                                  }
                                } catch (e) {
                                  setToast({
                                    msg: e.message || "Erreur lors de la création du contrôle",
                                    type: "error",
                                  });
                                }
                              }}
                              className="text-sm flex items-center gap-1 text-blue-600 hover:text-blue-800 border border-blue-200 bg-white px-2 py-1 rounded-lg hover:bg-blue-50 transition"
                            >
                              <Plus size={16} /> Nouveau contrôle
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------- VUE PAR BÂTIMENT ---------------------------- */}
      <div
        id="panel-buildings"
        role="tabpanel"
        aria-labelledby="tab-buildings"
        hidden={tab !== "buildings"}
      >
        {tab === "buildings" && (
          <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
            {/* En-tête */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Home className="text-indigo-600" /> Vue par bâtiment
              </h2>
              <button onClick={refreshUpcoming} className={btn()}>
                Rafraîchir
              </button>
            </div>

            {/* États de chargement */}
            {loadingUpcoming ? (
              <div className="text-gray-500 text-sm italic">Chargement des bâtiments…</div>
            ) : upcoming.length === 0 ? (
              <div className="text-gray-600 text-sm">
                Aucun bâtiment trouvé dans les contrôles périodiques.
              </div>
            ) : (
              <div className="grid gap-5">
                {upcoming.map((b, i) => (
                  <div
                    key={b.id || i}
                    className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden"
                  >
                    {/* En-tête du bâtiment */}
                    <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Building2 className="text-indigo-600" />
                        <span className="font-semibold text-gray-900">{b.building}</span>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap justify-end">
                        <span className="text-sm text-gray-500">
                          Prochain contrôle :{" "}
                          <strong className="text-blue-700">{b.next_due_year}</strong>
                        </span>

                        {/* DropInput pour rapport initial */}
                        <DropInput
                          label="Rapport initial (optionnel)"
                          multiple={false}
                          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          onFiles={(files) =>
                            setFileReportsNew((prev) => ({
                              ...prev,
                              [b.building]: files[0] || null,
                            }))
                          }
                        />

                        {/* ➕ Nouveau contrôle */}
                        <button
                          onClick={async () => {
                            try {
                              const payload = {
                                building: b.building,
                                year: new Date().getFullYear(),
                              };
                              const res = await api.oibt.createPeriodic(payload);
                              if (res?.id) {
                                const selectedFile = fileReportsNew[b.building];
                                if (selectedFile) {
                                  const fd = new FormData();
                                  fd.append("file", selectedFile);
                                  await api.oibt.uploadPeriodicFile(res.id, "report", fd);
                                }

                                setToast({
                                  msg: `Nouveau contrôle créé pour ${b.building}`,
                                  type: "success",
                                });
                                setFileReportsNew((prev) => ({
                                  ...prev,
                                  [b.building]: null,
                                }));
                                await refreshAll();
                                window.openPeriodicDetails(res.id);
                              } else {
                                setToast({
                                  msg: "Création du contrôle échouée.",
                                  type: "error",
                                });
                              }
                            } catch (e) {
                              setToast({
                                msg:
                                  e.message || "Erreur lors de la création du contrôle",
                                type: "error",
                              });
                            }
                          }}
                          className="text-sm flex items-center gap-1 text-blue-600 hover:text-blue-800 border border-blue-200 bg-white px-2 py-1 rounded-lg hover:bg-blue-50 transition"
                        >
                          <Plus size={16} /> Nouveau contrôle
                        </button>
                      </div>
                    </div>

                    {/* Liste des contrôles passés */}
                    <div className="p-4">
                      {b.history && b.history.length > 0 ? (
                        <div className="grid gap-2">
                          {b.history.map((h, j) => (
                            <div
                              key={h.id || j}
                              className="flex justify-between items-center border border-gray-100 rounded-lg px-3 py-2 hover:bg-blue-50 transition"
                            >
                              <div className="flex items-center gap-3">
                                <CalendarClock className="text-blue-600" size={16} />
                                <div>
                                  <div className="font-medium text-gray-900">
                                    Contrôle {h.year}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    Créé le{" "}
                                    {h.created_at ? toFR(new Date(h.created_at)) : "—"}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {h.id ? (
                                  <>
                                    <a
                                      href={`${API_BASE}/api/oibt/periodics/${h.id}/download?type=report`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                                    >
                                      <Download size={14} /> Rapport
                                    </a>
                                    <button
                                      onClick={() => window.openPeriodicDetails(h.id)}
                                      className="text-blue-600 hover:underline text-sm"
                                    >
                                      Voir
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-gray-400 text-sm">—</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-500 text-sm">
                          Aucun historique de contrôle pour ce bâtiment.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------ ANALYSIS ----------------------------- */}
      <div id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden={tab !== "analysis"}>
        {tab === "analysis" && (
          <Analysis
            projects={projects}
            periodics={periodics}
            projectProgress={projectProgress}
            periodicProgress={periodicProgress}
            sporadNeeded={sporadNeeded}
            sporadAssigned={sporadAssigned}
          />
        )}
      </div>

      {/* Confirm delete (projet ou périodique) */}
      <ConfirmModal
        open={confirm.open}
        title="Supprimer"
        message="Es-tu sûr de vouloir supprimer cet élément ? Cette action est définitive."
        onConfirm={() => {
          if (!confirm.id) return setConfirm({ open: false, id: null });
          if (String(confirm.id).startsWith("per-")) {
            deletePeriodic(Number(String(confirm.id).slice(4)));
          } else {
            deleteProject(confirm.id);
          }
          setConfirm({ open: false, id: null });
        }}
        onCancel={() => setConfirm({ open: false, id: null })}
      />

      {/* Toast */}
      <Toast {...toast} onClose={() => setToast(null)} />
    </section>
  );
}

/* --------------------------- LISTE DE FICHIERS UI --------------------------- */
function FilesList({ list, onLoad, makeHref }) {
  return (
    <div className="mt-1">
      <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
        <Paperclip size={14}/> Pièces jointes
        {list === undefined && (
          <button onClick={onLoad} className="ml-2 text-blue-600 hover:underline">
            Charger
          </button>
        )}
        {list !== undefined && (
          <button onClick={() => onLoad()} className="ml-2 text-blue-600 hover:underline">
            Recharger
          </button>
        )}
      </div>
      {list === null && (
        <div className="text-xs text-gray-500">
          Listing non disponible côté serveur — utilisez le lien « Télécharger le dernier ».
        </div>
      )}
      {Array.isArray(list) && list.length === 0 && (
        <div className="text-xs text-gray-500">Aucun fichier.</div>
      )}
      {Array.isArray(list) && list.length > 0 && (
        <ul className="text-sm text-gray-800 flex flex-col gap-1">
          {list.map(f => (
            <li key={f.id} className="flex items-center gap-2">
              <a
                href={makeHref(f.id)}
                className="text-blue-600 hover:underline flex items-center gap-1"
                target="_blank" rel="noreferrer"
                title={f.original_name}
              >
                <Download size={16} /> {f.original_name}
              </a>
              {f.uploaded_at && <span className="text-xs text-gray-500">({toFRdt(new Date(f.uploaded_at))})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ ANALYSIS TAB ------------------------------ */
function Analysis({ projects, periodics, projectProgress, periodicProgress, sporadNeeded, sporadAssigned }) {
  const stats = useMemo(() => {
    const prCount = projects.length;
    const prAvg = prCount ? Math.round(projects.map(projectProgress).reduce((a,b)=>a+b,0)/prCount) : 0;

    const peCount = periodics.length;
    const peAvg = peCount ? Math.round(periodics.map(periodicProgress).reduce((a,b)=>a+b,0)/peCount) : 0;

    const today = new Date();
    const soon = []; // <30j
    const late = []; // dépassé
    for (const p of projects) {
      const rec = (p.status || []).find(a => (a.key==="reception") || a.name==="Contrôle de réception");
      if (rec?.due && !rec.done) {
        const [d,m,y] = rec.due.split("/").map(Number);
        const due = new Date(y, m-1, d);
        const diff = Math.ceil((due - today) / (1000*60*60*24));
        if (diff < 0) late.push({ title: p.title, due: rec.due, diff });
        else if (diff <= 30) soon.push({ title: p.title, due: rec.due, diff });
      }
    }
    return { prCount, prAvg, peCount, peAvg, soon, late };
  }, [projects, periodics, projectProgress, periodicProgress]);

  return (
    <div className="grid gap-6">
      <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Vue d’ensemble</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <CardStat label="Projets" value={stats.prCount} />
          <CardStat label="Avancement projets" value={`${stats.prAvg}%`} bar={stats.prAvg} />
          <CardStat label="Périodiques" value={stats.peCount} />
          <CardStat label="Avancement périodiques" value={`${stats.peAvg}%`} bar={stats.peAvg} />
          <CardStat label="Sporadique (besoin/assignés)" value={`${sporadNeeded}/${sporadAssigned}`} />
        </div>
      </div>

      {(stats.late.length > 0 || stats.soon.length > 0) && (
        <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">Contrôles de réception à surveiller</h3>
          {stats.late.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-medium text-red-700 flex items-center gap-2"><AlertTriangle /> En retard</div>
              <ul className="mt-2 space-y-1">
                {stats.late.map((r, i) => (
                  <li key={`late-${i}`} className="text-sm text-red-700">
                    {r.title} — dû le {r.due} ({-r.diff} j de retard)
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stats.soon.length > 0 && (
            <div>
              <div className="text-sm font-medium text-amber-700 flex items-center gap-2"><CalendarClock /> À venir (&lt;= 30j)</div>
              <ul className="mt-2 space-y-1">
                {stats.soon.map((r, i) => (
                  <li key={`soon-${i}`} className="text-sm text-amber-700">
                    {r.title} — dû le {r.due} (dans {r.diff} j)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CardStat({ label, value, bar }) {
  return (
    <div className="p-4 rounded-xl border bg-gray-50">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {typeof bar === "number" && (
        <div className="mt-2">
          <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
            <div className="h-2 bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
