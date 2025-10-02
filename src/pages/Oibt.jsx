import { useEffect, useMemo, useState } from "react";
import { api, API_BASE } from "../lib/api.js";
import { Folder, FileText, CalendarClock, Upload, Download, CheckCircle, XCircle, Trash2 } from "lucide-react";

function clsInput() {
  return "w-full bg-white text-gray-900 placeholder-gray-400 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
}
function btnPrimary() { return "px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"; }
function btn() { return "px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90"; }
function badge(ok) {
  return ok ? "inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded"
            : "inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded";
}
function Toast({ msg, type, onClose }) {
  if (!msg) return null;
  const colors = { success: "bg-green-600", error: "bg-red-600", info: "bg-blue-600", warn: "bg-amber-500" };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${colors[type] || colors.info}`}>
      <div className="flex items-center gap-3">
        <span>{msg}</span>
        <button onClick={onClose} className="bg-white/20 rounded px-2 py-0.5">OK</button>
      </div>
    </div>
  );
}
function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
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
}

export default function Oibt() {
  // Projets
  const [projects, setProjects] = useState([]);
  const [qProj, setQProj] = useState("");
  const [title, setTitle] = useState("");

  // Periodiques
  const [periodics, setPeriodics] = useState([]);
  const [qBuild, setQBuild] = useState("");
  const [building, setBuilding] = useState("");
  const [fileReport, setFileReport] = useState(null);

  // UI/State
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
    } catch (e) {
      setToast({ msg: e.message || "Erreur de chargement", type: "error" });
    }
  }

  const filteredProjects = useMemo(() => {
    const q = qProj.trim().toLowerCase();
    return !q ? projects : projects.filter(p => p.title?.toLowerCase().includes(q));
  }, [projects, qProj]);

  const filteredPeriodics = useMemo(() => {
    const q = qBuild.trim().toLowerCase();
    return !q ? periodics : periodics.filter(c => c.building?.toLowerCase().includes(q));
  }, [periodics, qBuild]);

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

  async function togglePeriodicFlag(row, key) {
    try {
      const upd = await api.oibt.updatePeriodic(row.id, {
        defect_report_received: key === "defect" ? !row.defect_report_received : row.defect_report_received,
        confirmation_received: key === "confirm" ? !row.confirmation_received : row.confirmation_received,
      });
      setPeriodics(s => s.map(c => c.id === row.id ? upd : c));
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

  async function uploadProjectFile(id, action, file) {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      await api.oibt.uploadProjectActionFile(id, action, fd);
      await refreshAll();
      setToast({ msg: "Pièce jointe ajoutée", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  const projFileUrl = (id, action) => `${API_BASE || ""}/api/oibt/projects/${id}/download?action=${encodeURIComponent(action)}`;
  const perFileUrl  = (id, type)   => `${API_BASE || ""}/api/oibt/periodics/${id}/download?type=${encodeURIComponent(type)}`;

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">OIBT – Installation & Contrôles</h1>
        <p className="text-gray-600">Avis d’installation, protocoles, rapports de sécurité, contrôle de réception et contrôles périodiques.</p>
      </header>

      {/* ---------- PROJETS ---------- */}
      <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200 mb-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Folder /> Projets</h2>
          <div className="flex gap-2">
            <input value={qProj} onChange={e => setQProj(e.target.value)} placeholder="Filtrer par titre…" className={clsInput()} style={{ maxWidth: 280 }} />
            <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titre du projet" className={clsInput()} />
          <button onClick={createProject} className={btnPrimary()}>Créer</button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {filteredProjects.map(p => (
            <div key={p.id} className="p-4 rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Folder className="text-indigo-500" />
                  <h3 className="font-medium text-gray-900">{p.title}</h3>
                </div>
                <button onClick={() => setConfirm({ open: true, id: p.id })} title="Supprimer" className="text-red-600 hover:text-red-700"><Trash2 /></button>
              </div>

              <ul className="mt-3 space-y-3">
                {(p.status || []).map((a, i) => {
                  const key = a.key || (a.name?.includes("Avis") ? "avis" : a.name?.includes("Protocole") ? "protocole" : a.name?.includes("Rapport") ? "rapport" : "reception");
                  const hasFile = p.attachments?.[key];
                  return (
                    <li key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm text-gray-900">
                          <input type="checkbox" checked={!!a.done} onChange={() => toggleAction(p.id, i)} />
                          <span className="flex items-center gap-2"><FileText className="text-gray-500" /> {a.name}</span>
                          {a.due && <span className="text-xs text-gray-500 flex items-center gap-1"><CalendarClock size={14} /> Échéance {a.due}</span>}
                        </label>
                        <span className={badge(!!hasFile)}>{hasFile ? "Pièce jointe" : "—"}</span>
                      </div>

                      <div className="mt-2 flex items-center gap-3">
                        <label className="text-xs text-gray-700">
                          <span className="sr-only">Joindre un fichier</span>
                          <input
                            type="file"
                            onChange={e => uploadProjectFile(p.id, key, e.target.files?.[0])}
                            className="block w-full text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          />
                        </label>
                        {hasFile && (
                          <a href={projFileUrl(p.id, key)} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                            <Download size={16} /> Télécharger
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {filteredProjects.length === 0 && (
            <div className="text-sm text-gray-600">Aucun projet.</div>
          )}
        </div>
      </div>

      {/* ---------- CONTROLES PERIODIQUES ---------- */}
      <div className="p-5 rounded-2xl bg-white shadow-md border border-gray-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><FileText /> Contrôles périodiques</h2>
          <div className="flex gap-2">
            <input value={qBuild} onChange={e => setQBuild(e.target.value)} placeholder="Filtrer par bâtiment…" className={clsInput()} style={{ maxWidth: 280 }} />
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
          {filteredPeriodics.map(c => (
            <div key={c.id} className="p-4 rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">{c.building}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={badge(!!c.has_report)}>Rapport {c.has_report ? "disponible" : "—"}</span>
                    <span className={badge(!!c.has_defect)}>Défauts {c.has_defect ? "joint" : "—"}</span>
                    <span className={badge(!!c.has_confirmation)}>Confirmation {c.has_confirmation ? "jointe" : "—"}</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500">{c.updated_at ? new Date(c.updated_at).toLocaleString("fr-FR") : ""}</div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {/* Rapport */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Rapport</div>
                  <div className="flex items-center gap-2">
                    <input type="file" onChange={e => uploadPeriodic(c.id, "report", e.target.files?.[0])}
                      className="block w-full text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
                    {c.has_report && <a className="text-sm text-blue-600 hover:underline flex items-center gap-1" href={perFileUrl(c.id, "report")} target="_blank" rel="noreferrer"><Download size={16}/> Télécharger</a>}
                  </div>
                </div>

                {/* Défauts */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Élimination des défauts</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input type="checkbox" checked={!!c.defect_report_received} onChange={() => togglePeriodicFlag(c, "defect")} />
                      Reçu
                    </label>
                    <input type="file" onChange={e => uploadPeriodic(c.id, "defect", e.target.files?.[0])}
                      className="block flex-1 text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
                    {c.has_defect && <a className="text-sm text-blue-600 hover:underline flex items-center gap-1" href={perFileUrl(c.id, "defect")} target="_blank" rel="noreferrer"><Download size={16}/> Télécharger</a>}
                  </div>
                </div>

                {/* Confirmation */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Confirmation</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input type="checkbox" checked={!!c.confirmation_received} onChange={() => togglePeriodicFlag(c, "confirm")} />
                      Reçue
                    </label>
                    <input type="file" onChange={e => uploadPeriodic(c.id, "confirmation", e.target.files?.[0])}
                      className="block flex-1 text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
                    {c.has_confirmation && <a className="text-sm text-blue-600 hover:underline flex items-center gap-1" href={perFileUrl(c.id, "confirmation")} target="_blank" rel="noreferrer"><Download size={16}/> Télécharger</a>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {filteredPeriodics.length === 0 && <div className="text-sm text-gray-600">Aucun contrôle périodique.</div>}
        </div>
      </div>

      {/* Confirm delete */}
      <ConfirmModal
        open={confirm.open}
        title="Supprimer le projet"
        message="Es-tu sûr de vouloir supprimer ce projet ? Cette action est définitive."
        onConfirm={() => { deleteProject(confirm.id); setConfirm({ open: false, id: null }); }}
        onCancel={() => setConfirm({ open: false, id: null })}
      />

      {/* Toast */}
      <Toast {...toast} onClose={() => setToast(null)} />
    </section>
  );
}
