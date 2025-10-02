import { useEffect, useMemo, useState, useCallback } from "react";
import { api, API_BASE } from "../lib/api.js";
import {
  Folder, FileText, CalendarClock, Download, Trash2, BarChart3,
  AlertTriangle, CheckCircle2, XCircle
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

/* ------------------------------ PAGE OIBT ------------------------------ */
export default function Oibt() {
  const [tab, setTab] = useState("projects"); // projects | periodics | analysis

  // Projets
  const [projects, setProjects] = useState([]);
  const [qProj, setQProj] = useState("");
  const [title, setTitle] = useState("");

  // Périodiques
  const [periodics, setPeriodics] = useState([]);
  const [qBuild, setQBuild] = useState("");
  const [building, setBuilding] = useState("");
  const [fileReport, setFileReport] = useState(null);

  // UI
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, id: null });

  useEffect(() => { refreshAll(); }, []);
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

  /* ---------------------------- FILTERED LISTS ---------------------------- */
  const filteredProjects = useMemo(() => {
    const q = qProj.trim().toLowerCase();
    return !q ? projects : projects.filter(p => p.title?.toLowerCase().includes(q));
  }, [projects, qProj]);

  const filteredPeriodics = useMemo(() => {
    const q = qBuild.trim().toLowerCase();
    return !q ? periodics : periodics.filter(c => c.building?.toLowerCase().includes(q));
  }, [periodics, qBuild]);

  /* ------------------------------ PROGRESS ------------------------------ */
  const projectProgress = (p) => {
    const n = (p.status || []).length || 1;
    const done = (p.status || []).filter(a => a.done).length;
    return Math.round((done / n) * 100);
  };
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
  async function toggleAction(projectId, index) {
    const pj = projects.find(p => p.id === projectId);
    if (!pj) return;
    const next = (pj.status || []).map((a, i) => i === index ? { ...a, done: !a.done } : a);
    try {
      const upd = await api.oibt.updateProject(projectId, { status: next });
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
  async function uploadProjectFile(id, action, file) {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      await api.oibt.uploadProjectActionFile(id, action, fd);
      await refreshAll();
      setToast({ msg: "Pièce jointe ajoutée", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function addPeriodic() {
    if (!building.trim()) return;
    try {
      const row = await api.oibt.createPeriodic({ building: building.trim() });
      if (fileReport) {
        const fd = new FormData(); fd.append("file", fileReport);
        await api.oibt.uploadPeriodicFile(row.id, "report", fd);
      }
      setBuilding(""); setFileReport(null);
      await refreshAll();
      setToast({ msg: "Contrôle périodique ajouté", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }
  async function uploadPeriodic(id, type, file) {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const upd = await api.oibt.uploadPeriodicFile(id, type, fd);
      setPeriodics(s => s.map(c => c.id === id ? upd : c));
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }
  async function togglePeriodic(row, key) {
    try {
      const body = {
        report_received: key === "report" ? !row.report_received : row.report_received,
        defect_report_received: key === "defect" ? !row.defect_report_received : row.defect_report_received,
        confirmation_received: key === "confirm" ? !row.confirmation_received : row.confirmation_received,
      };
      const upd = await api.oibt.updatePeriodic(row.id, body);
      setPeriodics(s => s.map(c => c.id === row.id ? upd : c));
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }
  async function deletePeriodic(id) {
    try {
      await api.oibt.removePeriodic(id);
      setPeriodics(s => s.filter(c => c.id !== id));
      setToast({ msg: "Bâtiment supprimé", type: "info" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  /* ------------------------------ FILE URLS ------------------------------ */
  const projFileUrl = (id, action) => `${API_BASE || ""}/api/oibt/projects/${id}/download?action=${encodeURIComponent(action)}`;
  const perFileUrl  = (id, type)   => `${API_BASE || ""}/api/oibt/periodics/${id}/download?type=${encodeURIComponent(type)}`;

  /* ------------------------------ ALERTES ------------------------------ */
  const alerts = useMemo(() => {
    const out = { project: [], periodic: [] };
    const today = new Date();

    // Projets: Avis manquant + Réception <30j ou en retard
    for (const p of projects) {
      const att = p.attachments || {};
      if (!att.avis) {
        out.project.push({ level: "warn", text: `Projet « ${p.title} » — Avis d’installation manquant.` });
      }
      const rec = (p.status || []).find(a => a.key === "reception" || a.name === "Contrôle de réception");
      if (rec?.due && !rec.done) {
        const [d, m, y] = rec.due.split("/").map(Number);
        const due = new Date(y, m - 1, d);
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        if (diff < 0) out.project.push({ level: "error", text: `Projet « ${p.title} » — Contrôle de réception en retard (dû le ${rec.due}).` });
        else if (diff <= 30) out.project.push({ level: "warn", text: `Projet « ${p.title} » — Réception dans ${diff} jours (dû le ${rec.due}).` });
      }
    }

    // Périodiques: fenêtres 3/6 mois après report_received_at tant que défaut/confirmation non reçus
    for (const c of periodics) {
      if (c.report_received && c.report_received_at) {
        const base = new Date(c.report_received_at);
        const plus3 = new Date(base); plus3.setMonth(plus3.getMonth() + 3);
        const plus6 = new Date(base); plus6.setMonth(plus6.getMonth() + 6);

        if (!c.defect_report_received) {
          if (today > plus6) out.periodic.push({ level: "error", text: `Périodique « ${c.building} » — délai 6 mois dépassé pour l’élimination des défauts.` });
          else if (today > plus3) out.periodic.push({ level: "warn", text: `Périodique « ${c.building} » — dépassement 3 mois, corriger avant 6 mois.` });
          else {
            const days = Math.ceil((plus3 - today) / (1000 * 60 * 60 * 24));
            if (days <= 30) out.periodic.push({ level: "info", text: `Périodique « ${c.building} » — correction à effectuer sous ${days} jours (jalon 3 mois).` });
          }
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
    { id: "analysis", label: "Analysis" },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      <header className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <BarChart3 /> OIBT – Installation &amp; Contrôles
        </h1>
        <p className="text-gray-600">Avis d’installation, protocoles, rapports de sécurité, contrôle de réception et contrôles périodiques.</p>
      </header>

      {/* Statut global */}
      <div className="mb-4">
        {hasAnyAlert ? (
          <div className="grid gap-2">
            {alerts.project.map((a, i) => <AlertBanner key={`pa-${i}`} item={a} />)}
            {alerts.periodic.map((a, i) => <AlertBanner key={`pe-${i}`} item={a} />)}
          </div>
        ) : (
          <div className="px-3 py-2 rounded border bg-emerald-100 text-emerald-800 border-emerald-200 flex items-center gap-2">
            <CheckCircle2 size={16} /> <span className="text-sm">Aucune alerte en cours — tout est OK ✅</span>
          </div>
        )}
      </div>

      {/* Onglets responsives */}
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ------------------------------ PROJETS ------------------------------ */}
      <div
        id="panel-projects"
        role="tabpanel"
        aria-labelledby="tab-projects"
        hidden={tab !== "projects"}
      >
        {tab === "projects" && (
          <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200 mb-8">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Folder /> Projets</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <input value={qProj} onChange={e => setQProj(e.target.value)} placeholder="Filtrer par titre…" className={clsInput()} />
                <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
              </div>
            </div>

            <div className="mt-4 flex gap-2 flex-col sm:flex-row">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titre du projet" className={clsInput()} />
              <button onClick={createProject} className={btnPrimary()}>Créer</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {filteredProjects.map(p => {
                const progress = projectProgress(p);
                const reception = (p.status || []).find(a => (a.key==="reception") || a.name==="Contrôle de réception");
                const late = (() => {
                  if (!reception?.due || reception.done) return false;
                  const [d,m,y] = reception.due.split("/").map(Number);
                  const due = new Date(y, m-1, d);
                  return due < new Date();
                })();
                return (
                  <div key={p.id} className="p-4 rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Folder className="text-indigo-500" />
                        <h3 className="font-medium text-gray-900">{p.title}</h3>
                      </div>
                      <button onClick={() => setConfirm({ open: true, id: p.id })} title="Supprimer" className="text-red-600 hover:text-red-700"><Trash2 /></button>
                    </div>

                    <div className="mt-3">
                      <Progress value={progress} />
                      <div className="mt-1 text-xs text-gray-600">{progress}%</div>
                      {reception?.due && !reception.done && (
                        <div className={`mt-1 text-xs flex items-center gap-1 ${late ? "text-red-600" : "text-gray-600"}`}>
                          <CalendarClock size={14} /> Réception avant le {reception.due} {late && <span className="inline-flex items-center gap-1"><AlertTriangle size={14}/>en retard</span>}
                        </div>
                      )}
                    </div>

                    <ul className="mt-3 space-y-3">
                      {(p.status || []).map((a, i) => {
                        const key = a.key || (a.name?.includes("Avis") ? "avis" : a.name?.includes("Protocole") ? "protocole" : a.name?.includes("Rapport") ? "rapport" : "reception");
                        const hasFile = !!p.attachments?.[key];
                        return (
                          <li key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                            <div className="flex items-center justify-between gap-3">
                              <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap">
                                <input type="checkbox" checked={!!a.done} onChange={() => toggleAction(p.id, i)} />
                                <span className="flex items-center gap-2"><FileText className="text-gray-500" /> {a.name}</span>
                                {a.due && <span className="text-xs text-gray-500 flex items-center gap-1"><CalendarClock size={14} /> Échéance {a.due}</span>}
                              </label>
                              <Badge ok={hasFile} label={hasFile ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                type="file"
                                onChange={e => uploadProjectFile(p.id, key, e.target.files?.[0])}
                                className="block text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white flex-1 min-w-[220px]"
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                              />
                              {hasFile && (
                                <a href={projFileUrl(p.id, key)} target="_blank" rel="noreferrer"
                                   className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0">
                                  <Download size={16} /> Télécharger
                                </a>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><FileText /> Contrôles périodiques</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <input value={qBuild} onChange={e => setQBuild(e.target.value)} placeholder="Filtrer par bâtiment…" className={clsInput()} />
                <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input value={building} onChange={e => setBuilding(e.target.value)} placeholder="Nom du bâtiment" className={clsInput()} />
              <input type="file" onChange={e => setFileReport(e.target.files?.[0] || null)}
                     className="block w-full text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white"
                     accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
              <button onClick={addPeriodic} className={btnPrimary()}>Ajouter</button>
            </div>

            <div className="mt-4 grid gap-4">
              {filteredPeriodics.map(c => {
                const progress = periodicProgress(c);
                return (
                  <div key={c.id} className="p-4 rounded-xl border border-gray-200 bg-white">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-gray-900">{c.building}</div>
                        <div className="mt-2">
                          <Progress value={progress} />
                          <div className="mt-1 text-xs text-gray-600">{progress}%</div>
                        </div>
                      </div>
                      <button onClick={() => setConfirm({ open: true, id: `per-${c.id}` })} title="Supprimer" className="text-red-600 hover:text-red-700"><Trash2 /></button>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                      {/* Rapport de contrôle périodique */}
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-gray-900">Rapport de contrôle périodique</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                            <input type="checkbox" checked={!!c.report_received} onChange={() => togglePeriodic(c, "report")} />
                            Reçu
                          </label>
                          <input
                            type="file"
                            onChange={e => uploadPeriodic(c.id, "report", e.target.files?.[0])}
                            className="block text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white flex-1 min-w-[220px]"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          />
                          <Badge ok={!!c.has_report} label={c.has_report ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                          {c.has_report && (
                            <a className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0" href={perFileUrl(c.id, "report")} target="_blank" rel="noreferrer">
                              <Download size={16}/> Télécharger
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Élimination des défauts */}
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-gray-900">Élimination des défauts</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                            <input type="checkbox" checked={!!c.defect_report_received} onChange={() => togglePeriodic(c, "defect")} />
                            Reçus
                          </label>
                          <input
                            type="file"
                            onChange={e => uploadPeriodic(c.id, "defect", e.target.files?.[0])}
                            className="block text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white flex-1 min-w-[220px]"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          />
                          <Badge ok={!!c.has_defect} label={c.has_defect ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                          {c.has_defect && (
                            <a className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0" href={perFileUrl(c.id, "defect")} target="_blank" rel="noreferrer">
                              <Download size={16}/> Télécharger
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Confirmation */}
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-gray-900">Confirmation</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-sm text-gray-900 whitespace-nowrap shrink-0">
                            <input type="checkbox" checked={!!c.confirmation_received} onChange={() => togglePeriodic(c, "confirm")} />
                            Reçue
                          </label>
                          <input
                            type="file"
                            onChange={e => uploadPeriodic(c.id, "confirmation", e.target.files?.[0])}
                            className="block text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white flex-1 min-w-[220px]"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          />
                          <Badge ok={!!c.has_confirmation} label={c.has_confirmation ? "Fichier joint" : "Aucun fichier"} className="shrink-0" />
                          {c.has_confirmation && (
                            <a className="text-sm text-blue-600 hover:underline flex items-center gap-1 shrink-0" href={perFileUrl(c.id, "confirmation")} target="_blank" rel="noreferrer">
                              <Download size={16}/> Télécharger
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredPeriodics.length === 0 && <div className="text-sm text-gray-600">Aucun contrôle périodique.</div>}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------ ANALYSIS ----------------------------- */}
      <div
        id="panel-analysis"
        role="tabpanel"
        aria-labelledby="tab-analysis"
        hidden={tab !== "analysis"}
      >
        {tab === "analysis" && (
          <Analysis
            projects={projects}
            periodics={periodics}
            projectProgress={projectProgress}
            periodicProgress={periodicProgress}
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

/* ------------------------------ ANALYSIS TAB ------------------------------ */
function Analysis({ projects, periodics, projectProgress, periodicProgress }) {
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardStat label="Projets" value={stats.prCount} />
          <CardStat label="Avancement projets" value={`${stats.prAvg}%`} bar={stats.prAvg} />
          <CardStat label="Périodiques" value={stats.peCount} />
          <CardStat label="Avancement périodiques" value={`${stats.peAvg}%`} bar={stats.peAvg} />
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
