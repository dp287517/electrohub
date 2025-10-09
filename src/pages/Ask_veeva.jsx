// src/pages/Ask_veeva.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { uploadSmart, pollJob } from "../utils/ask_veeva.js";

export default function AskVeevaPage() {
  const [health, setHealth] = useState(null);
  const [files, setFiles] = useState([]);        // FileList -> Array<File>
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);          // [{ id, status, ... }]
  const [uploadProgress, setUploadProgress] = useState(null); // {part,totalParts,progress}

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);

  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const h = await api.askVeeva.health();
        setHealth(h);
      } catch (e) {
        setHealth({ ok: false, error: e.message || String(e) });
      }
    })();
  }, []);

  function onPickClick() {
    inputRef.current?.click();
  }

  function onFilesPicked(e) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  function onDrop(ev) {
    ev.preventDefault();
    const list = Array.from(ev.dataTransfer?.files || []);
    setFiles(list);
  }
  function onDragOver(ev) { ev.preventDefault(); }

  async function handleUpload() {
    if (!files.length) return;
    setBusy(true);
    setUploadProgress(null);
    const createdJobs = [];

    // Envoie un par un (si multiples fichiers unitaires)
    for (const file of files) {
      try {
        const res = await uploadSmart(file, setUploadProgress);
        // res: {job_id, ok,...}
        if (res?.job_id) {
          createdJobs.push({ id: res.job_id });
          // démarrer polling
          const stop = pollJob(res.job_id, {
            onTick: (j) => {
              setJobs(prev => {
                const idx = prev.findIndex(x => x.id === j.id);
                if (idx >= 0) {
                  const copy = prev.slice();
                  copy[idx] = j;
                  return copy;
                }
                return [...prev, j];
              });
            }
          });
          // on pourrait stocker stop() si on veut stopper manuellement
        }
      } catch (e) {
        alert(`Upload échoué pour ${file.name}: ${e.message || e}`);
      } finally {
        setUploadProgress(null);
      }
    }

    setBusy(false);
    setFiles([]);
  }

  async function runSearch() {
    setMatches([]);
    if (!query.trim()) return;
    try {
      const out = await api.askVeeva.search({ query, k: 8 });
      setMatches(out.matches || []);
    } catch (e) {
      alert(e.message || e);
    }
  }

  async function runAsk() {
    setAnswer(null);
    if (!question.trim()) return;
    try {
      const out = await api.askVeeva.ask({ question, k: 6 });
      setAnswer(out);
    } catch (e) {
      alert(e.message || e);
    }
  }

  const canUpload = useMemo(() => files.length > 0 && !busy, [files, busy]);

  return (
    <div className="max-w-6xl mx-auto py-6">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva — Lecture & Recherche documentaire</h1>
        <p className="text-gray-600 mt-1">
          Glissez-déposez vos fichiers (.zip, .pdf, .docx, .xlsx/.xls, .csv, .txt, .mp4). Les ZIP volumineux utilisent l’upload fractionné.
        </p>

        {health && (
          <div className={`mt-3 text-sm px-3 py-2 rounded ${health.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {health.ok ? (
              <>
                OK — embeddings: <code>{health.embeddings}</code>, modèle: <code>{health.model}</code>, dims: {health.dims}
                {!health.s3Configured && <span className="ml-2 text-amber-700">• S3 non configuré : mode upload fractionné activé si nécessaire</span>}
              </>
            ) : (
              <>Backend indisponible : {health.error}</>
            )}
          </div>
        )}
      </header>

      {/* UPLOAD */}
      <section className="grid gap-4 sm:grid-cols-5">
        <div className="sm:col-span-3">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border-2 border-dashed rounded-xl p-6 bg-white"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Importer des documents</div>
                <div className="text-sm text-gray-500">
                  ZIP &gt; 300 Mo : envoi en morceaux (aucune troncature). Vous pouvez aussi envoyer des fichiers unitaires.
                </div>
              </div>
              <button onClick={onPickClick} className="btn btn-primary whitespace-nowrap">
                Choisir des fichiers
              </button>
              <input ref={inputRef} type="file" multiple className="hidden"
                accept=".zip,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.mp4,.mov,.m4v"
                onChange={onFilesPicked} />
            </div>

            {files.length > 0 && (
              <ul className="mt-4 text-sm max-h-40 overflow-auto">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between py-1 border-b last:border-none">
                    <span className="truncate">{f.name}</span>
                    <span className="text-gray-500 ml-3">{(f.size / (1024*1024)).toFixed(1)} Mo</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleUpload}
                disabled={!canUpload}
                className={`btn ${canUpload ? 'btn-primary' : 'btn-disabled'}`}
              >
                {busy ? 'Envoi…' : 'Lancer l’upload'}
              </button>

              {uploadProgress && (
                <div className="flex-1">
                  <div className="text-xs text-gray-600 mb-1">
                    Part {uploadProgress.part}/{uploadProgress.totalParts}
                  </div>
                  <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2"
                      style={{ width: `${Math.max(0, Math.min(100, uploadProgress.progress))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Jobs */}
          <div className="mt-4 bg-white border rounded-xl p-4">
            <div className="font-medium mb-2">Ingestions en cours / récentes</div>
            {jobs.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun job encore.</div>
            ) : (
              <ul className="space-y-2">
                {jobs.map((j) => (
                  <li key={j.id} className="text-sm flex items-center justify-between">
                    <div className="truncate">
                      <span className="font-mono">{j.id.slice(0, 8)}</span>
                      <span className="ml-2 text-gray-600">{j.kind}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          j.status === 'done' ? 'bg-green-100 text-green-700' :
                          j.status === 'error' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {j.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        {j.processed_files}/{j.total_files}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Search & Ask */}
        <div className="sm:col-span-2">
          <div className="bg-white border rounded-xl p-4">
            <div className="font-medium mb-2">Recherche</div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher dans vos documents…"
                className="input flex-1"
              />
              <button onClick={runSearch} className="btn btn-secondary">Chercher</button>
            </div>
            {matches?.length > 0 && (
              <div className="mt-3 space-y-3 max-h-64 overflow-auto">
                {matches.map((m, idx) => (
                  <div key={idx} className="border rounded p-2">
                    <div className="text-xs text-gray-500 mb-1">{m.meta?.filename} — score {(m.score||0).toFixed(3)}</div>
                    <div className="text-sm whitespace-pre-wrap">{m.snippet}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border rounded-xl p-4 mt-4">
            <div className="font-medium mb-2">Poser une question</div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="input min-h-[100px]"
              placeholder="Ex: Quels sont les contrôles périodiques requis pour l’équipement X ?"
            />
            <div className="mt-2 flex justify-end">
              <button onClick={runAsk} className="btn btn-primary">Demander</button>
            </div>

            {answer && (
              <div className="mt-3">
                {answer.text && (
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap">{answer.text}</div>
                )}
                {answer.citations?.length > 0 && (
                  <div className="mt-2 text-xs text-gray-600">
                    <div className="font-medium">Citations :</div>
                    <ul className="list-disc ml-5">
                      {answer.citations.map((c, i) => (
                        <li key={i}>
                          {c.filename} <span className="text-gray-400">({(c.score||0).toFixed(3)})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </section>
    </div>
  );
}

/* ——————————————————————————————————————————————————————————————
 *  Styles utilitaires (si tu utilises Tailwind, tu as déjà ces classes ;
 *  sinon, adapte aux styles existants)
 *  .btn, .btn-primary, .btn-secondary, .btn-disabled, .input
 * —————————————————————————————————————————————————————————————— */
