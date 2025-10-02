import { useEffect, useState, useMemo } from "react";
import { api, API_BASE } from "../lib/api.js";

function inputCls() {
  return "w-full bg-white text-gray-900 placeholder-gray-400 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
}
function btnPrimary() {
  return "px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700";
}
function btn() {
  return "px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90";
}
function badge(ok) {
  return ok ? "inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded"
            : "inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded";
}

export default function Oibt() {
  // ---- Projects
  const [projects, setProjects] = useState([]);
  const [qProj, setQProj] = useState("");
  const [title, setTitle] = useState("");

  // ---- Periodics
  const [periodics, setPeriodics] = useState([]);
  const [qBuild, setQBuild] = useState("");
  const [building, setBuilding] = useState("");
  const [fileReport, setFileReport] = useState(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const filteredProjects = useMemo(() => {
    const q = qProj.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title?.toLowerCase().includes(q));
  }, [projects, qProj]);

  const filteredPeriodics = useMemo(() => {
    const q = qBuild.trim().toLowerCase();
    if (!q) return periodics;
    return periodics.filter((c) => c.building?.toLowerCase().includes(q));
  }, [periodics, qBuild]);

  useEffect(() => {
    refreshAll().catch(() => {});
  }, []);

  async function refreshAll() {
    setErr("");
    setLoading(true);
    try {
      const [pj, per] = await Promise.all([
        api.oibt.listProjects(),
        api.oibt.listPeriodics(),
      ]);
      setProjects(pj?.data || pj || []);
      setPeriodics(per?.data || per || []);
    } catch (e) {
      setErr(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    if (!title.trim()) return;
    setErr("");
    try {
      const p = await api.oibt.createProject({ title: title.trim() });
      setProjects([...(projects || []), p]);
      setTitle("");
    } catch (e) {
      setErr(e?.message || "Création projet impossible");
    }
  }

  async function toggleAction(projectId, index) {
    const pj = projects.find((p) => p.id === projectId);
    if (!pj) return;
    const next = (pj.status || []).map((a, i) =>
      i === index ? { ...a, done: !a.done } : a
    );
    try {
      const upd = await api.oibt.updateProject(projectId, { status: next });
      setProjects((s) => s.map((p) => (p.id === projectId ? upd : p)));
    } catch (e) {
      setErr(e?.message || "Mise à jour impossible");
    }
  }

  async function removeProject(id) {
    if (!confirm("Supprimer ce projet ?")) return;
    try {
      await api.oibt.removeProject(id);
      setProjects((s) => s.filter((p) => p.id !== id));
    } catch (e) {
      setErr(e?.message || "Suppression impossible");
    }
  }

  async function addPeriodic() {
    if (!building.trim()) return;
    setErr("");
    try {
      const row = await api.oibt.createPeriodic({ building: building.trim() });
      // upload du rapport initial si fourni
      if (fileReport) {
        const fd = new FormData();
        fd.append("file", fileReport);
        await api.oibt.uploadPeriodicFile(row.id, "report", fd);
      }
      setBuilding("");
      setFileReport(null);
      await refreshAll();
    } catch (e) {
      setErr(e?.message || "Ajout contrôle périodique impossible");
    }
  }

  async function togglePeriodicFlag(row, key) {
    try {
      const upd = await api.oibt.updatePeriodic(row.id, {
        defect_report_received: key === "defect" ? !row.defect_report_received : row.defect_report_received,
        confirmation_received: key === "confirm" ? !row.confirmation_received : row.confirmation_received,
      });
      setPeriodics((s) => s.map((c) => (c.id === row.id ? upd : c)));
    } catch (e) {
      setErr(e?.message || "Mise à jour impossible");
    }
  }

  async function onUpload(row, type, file) {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upd = await api.oibt.uploadPeriodicFile(row.id, type, fd);
      setPeriodics((s) => s.map((c) => (c.id === row.id ? upd : c)));
    } catch (e) {
      setErr(e?.message || "Upload impossible");
    }
  }

  const fileUrl = (id, type) => `${API_BASE || ""}/api/oibt/periodics/${id}/download?type=${encodeURIComponent(type)}`;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">OIBT – Suivi & Contrôles</h1>
        <p className="text-gray-700">
          Avis d’installation · Protocole de mesure · Rapport de sécurité · Contrôle de réception · Contrôles périodiques
        </p>
      </header>

      {err && (
        <div className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {err}
        </div>
      )}

      {/* ===== PROJETS ===== */}
      <section className="p-4 rounded-xl bg-white shadow-sm border border-gray-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-gray-900">Projets</h2>
          <div className="flex gap-2">
            <input
              value={qProj}
              onChange={(e) => setQProj(e.target.value)}
              placeholder="Filtrer par titre…"
              className={inputCls()}
              style={{ maxWidth: 260 }}
            />
            <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
          </div>
        </div>

        {/* Création projet */}
        <div className="mt-3 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre du projet"
            className={inputCls()}
          />
          <button onClick={createProject} className={btnPrimary()}>Créer</button>
        </div>

        {/* Liste */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {filteredProjects.map((p) => (
            <div key={p.id} className="p-4 rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">{p.title}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">
                    {(p.status || []).filter(a => a.done).length}/{(p.status || []).length} fait(s)
                  </span>
                  <button onClick={() => removeProject(p.id)} className="text-xs text-red-600 hover:underline">
                    Supprimer
                  </button>
                </div>
              </div>
              <ul className="mt-3 space-y-2">
                {(p.status || []).map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input
                        type="checkbox"
                        checked={!!a.done}
                        onChange={() => toggleAction(p.id, i)}
                      />
                      <span>{a.name}</span>
                      {a.due && (
                        <span className="text-xs text-gray-500">— échéance {a.due}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {filteredProjects.length === 0 && (
            <div className="text-sm text-gray-600">Aucun projet.</div>
          )}
        </div>
      </section>

      {/* ===== CONTROLES PERIODIQUES ===== */}
      <section className="p-4 rounded-xl bg-white shadow-sm border border-gray-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-gray-900">Contrôles périodiques (bâtiments)</h2>
          <div className="flex gap-2">
            <input
              value={qBuild}
              onChange={(e) => setQBuild(e.target.value)}
              placeholder="Filtrer par bâtiment…"
              className={inputCls()}
              style={{ maxWidth: 260 }}
            />
            <button onClick={refreshAll} className={btn()}>Rafraîchir</button>
          </div>
        </div>

        {/* Ajout d'un bâtiment + rapport initial */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <input
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            placeholder="Nom du bâtiment"
            className={inputCls()}
          />
          <input
            type="file"
            onChange={(e) => setFileReport(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer
                       border border-gray-300 rounded bg-white"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          />
          <button onClick={addPeriodic} className={btnPrimary()}>Ajouter</button>
        </div>

        {/* Liste */}
        <div className="mt-4 grid gap-4">
          {filteredPeriodics.map((c) => (
            <div key={c.id} className="p-4 rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{c.building}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={badge(!!c.has_report)}>Rapport {c.has_report ? "disponible" : "—"}</span>
                    <span className={badge(!!c.has_defect)}>Défauts {c.has_defect ? "joint" : "—"}</span>
                    <span className={badge(!!c.has_confirmation)}>Confirmation {c.has_confirmation ? "jointe" : "—"}</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {c.updated_at ? new Date(c.updated_at).toLocaleString("fr-FR") : ""}
                </div>
              </div>

              {/* Actions fichiers + flags */}
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {/* Rapport de contrôle périodique */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Rapport</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      onChange={(e) => onUpload(c, "report", e.target.files?.[0])}
                      className="block w-full text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer
                                 border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    />
                    {c.has_report && (
                      <a className="text-sm text-blue-600 hover:underline" href={fileUrl(c.id, "report")} target="_blank" rel="noreferrer">
                        Télécharger
                      </a>
                    )}
                  </div>
                </div>

                {/* Rapport d'élimination des défauts */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Élimination des défauts</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input
                        type="checkbox"
                        checked={!!c.defect_report_received}
                        onChange={() => togglePeriodicFlag(c, "defect")}
                      />
                      Reçu
                    </label>
                    <input
                      type="file"
                      onChange={(e) => onUpload(c, "defect", e.target.files?.[0])}
                      className="block flex-1 text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer
                                 border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    />
                    {c.has_defect && (
                      <a className="text-sm text-blue-600 hover:underline" href={fileUrl(c.id, "defect")} target="_blank" rel="noreferrer">
                        Télécharger
                      </a>
                    )}
                  </div>
                </div>

                {/* Confirmation */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-900">Confirmation</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input
                        type="checkbox"
                        checked={!!c.confirmation_received}
                        onChange={() => togglePeriodicFlag(c, "confirm")}
                      />
                      Reçue
                    </label>
                    <input
                      type="file"
                      onChange={(e) => onUpload(c, "confirmation", e.target.files?.[0])}
                      className="block flex-1 text-sm text-gray-900 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-900 file:cursor-pointer
                                 border border-gray-300 rounded bg-white"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    />
                    {c.has_confirmation && (
                      <a className="text-sm text-blue-600 hover:underline" href={fileUrl(c.id, "confirmation")} target="_blank" rel="noreferrer">
                        Télécharger
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {filteredPeriodics.length === 0 && (
            <div className="text-sm text-gray-600">Aucun contrôle périodique.</div>
          )}
        </div>
      </section>

      {loading && <div className="text-sm text-gray-600">Chargement…</div>}
    </div>
  );
}
