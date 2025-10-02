import { useEffect, useState } from "react";
import { api } from "../api";

export default function Oibt() {
  const [projects, setProjects] = useState([]);
  const [periodics, setPeriodics] = useState([]);
  const [title, setTitle] = useState("");

  useEffect(() => {
    api.oibt.listProjects().then(setProjects);
    api.oibt.listPeriodics().then(setPeriodics);
  }, []);

  const createProject = async () => {
    const p = await api.oibt.createProject({ title });
    setProjects([...projects, p]);
    setTitle("");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">OIBT Dashboard</h1>

      {/* Create new project */}
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border rounded px-2 py-1 flex-1"
          placeholder="Titre du projet"
        />
        <button
          onClick={createProject}
          className="bg-blue-600 text-white px-4 py-1 rounded"
        >
          Créer
        </button>
      </div>

      {/* Projects list */}
      <div className="grid gap-4">
        {projects.map((p) => (
          <div key={p.id} className="p-4 border rounded shadow-sm bg-white">
            <h2 className="font-semibold">{p.title}</h2>
            <ul className="mt-2">
              {p.status.map((a, i) => (
                <li key={i}>
                  <input type="checkbox" checked={a.done} readOnly /> {a.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Periodics */}
      <h2 className="text-xl font-bold mt-6">Contrôles Périodiques</h2>
      <div className="grid gap-4">
        {periodics.map((c) => (
          <div key={c.id} className="p-4 border rounded bg-white">
            <h3>{c.building}</h3>
            <p>Rapport: {c.report_url || "Non fourni"}</p>
            <p>Défauts reçus: {c.defect_report_received ? "✅" : "❌"}</p>
            <p>Confirmation reçue: {c.confirmation_received ? "✅" : "❌"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
