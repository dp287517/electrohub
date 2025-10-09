// src/pages/Ask_veeva.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, get, post } from "../lib/api.js"; // ✅ chemin + helpers nommés

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function useJobPolling(jobId, { interval = 1500 } = {}) {
  const [job, setJob] = useState(null);
  const timerRef = useRef(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      stop();
      setJob(null);
      return;
    }
    const tick = async () => {
      try {
        // ✅ helper global `get`, pas `api.get`
        const j = await get(`/api/ask-veeva/jobs/${jobId}`);
        setJob(j);
        if (j.status === "done" || j.status === "error") stop();
      } catch {
        stop();
      }
    };
    tick();
    timerRef.current = setInterval(tick, interval);
    return stop;
  }, [jobId, interval, stop]);

  return { job, stop };
}

export default function AskVeeva() {
  const [tab, setTab] = useState("ingest"); // ingest | search | ask
  const [dragActive, setDragActive] = useState(false);
  const [zipUploading, setZipUploading] = useState(false);
  const [filesUploading, setFilesUploading] = useState(false);
  const [lastJobId, setLastJobId] = useState("");
  const { job } = useJobPolling(lastJobId);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loadingAnswer, setLoadingAnswer] = useState(false);

  const progressPct = useMemo(() => {
    if (!job || !job.total_files) return 0;
    const pct = Math.round((job.processed_files / job.total_files) * 100);
    return isFinite(pct) ? pct : 0;
  }, [job]);

  // --- Upload ZIP ---
  const inputZipRef = useRef(null);
  const onPickZip = () => inputZipRef.current?.click();
  const onZipChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("zip", f);
    setZipUploading(true);
    try {
      // ✅ utiliser le helper `post` pour FormData
      const res = await post("/api/ask-veeva/uploadZip", fd);
      setLastJobId(res.job_id);
      setTab("ingest");
    } catch (err) {
      alert("Upload ZIP échoué: " + err.message);
    } finally {
      setZipUploading(false);
      e.target.value = "";
    }
  };

  // --- Upload Files ---
  const inputFilesRef = useRef(null);
  const onPickFiles = () => inputFilesRef.current?.click();
  const onFilesChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setFilesUploading(true);
    try {
      const res = await post("/api/ask-veeva/uploadFiles", fd);
      setLastJobId(res.job_id);
      setTab("ingest");
    } catch (err) {
      alert("Upload fichiers échoué: " + err.message);
    } finally {
      setFilesUploading(false);
      e.target.value = "";
    }
  };

  // --- Drag & drop ---
  const dropRef = useRef(null);
  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      const fd = new FormData();
      fd.append("zip", files[0]);
      setZipUploading(true);
      try {
        const res = await post("/api/ask-veeva/uploadZip", fd);
        setLastJobId(res.job_id);
        setTab("ingest");
      } catch (err) {
        alert("Upload ZIP échoué: " + err.message);
      } finally {
        setZipUploading(false);
      }
      return;
    }

    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setFilesUploading(true);
    try {
      const res = await post("/api/ask-veeva/uploadFiles", fd);
      setLastJobId(res.job_id);
      setTab("ingest");
    } catch (err) {
      alert("Upload fichiers échoué: " + err.message);
    } finally {
      setFilesUploading(false);
    }
  };

  // --- Recherche ---
  const runSearch = async () => {
    if (!query.trim()) return;
    try {
      const res = await api.askVeeva.search(query, 6);
      setMatches(res.matches || []);
      setTab("search");
    } catch (err) {
      alert("Recherche échouée: " + err.message);
    }
  };

  // --- Q/R ---
  const runAsk = async () => {
    if (!question.trim()) return;
    setLoadingAnswer(true);
    setAnswer(null);
    try {
      const res = await api.askVeeva.ask(question);
      setAnswer(res);
      setTab("ask");
    } catch (err) {
      setAnswer({ error: err.message });
    } finally {
      setLoadingAnswer(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Ask Veeva</h1>
          <nav className="flex flex-wrap gap-2">
            <button
              onClick={() => setTab("ingest")}
              className={classNames(
                "px-4 py-2 rounded-xl text-sm font-medium",
                tab === "ingest" ? "bg-black text-white" : "bg-white text-gray-700 border"
              )}
            >
              Importer / Indexer
            </button>
            <button
              onClick={() => setTab("search")}
              className={classNames(
                "px-4 py-2 rounded-xl text-sm font-medium",
                tab === "search" ? "bg-black text-white" : "bg-white text-gray-700 border"
              )}
            >
              Rechercher
            </button>
            <button
              onClick={() => setTab("ask")}
              className={classNames(
                "px-4 py-2 rounded-xl text-sm font-medium",
                tab === "ask" ? "bg-black text-white" : "bg-white text-gray-700 border"
              )}
            >
              Poser une question
            </button>
          </nav>
        </header>

        {/* Body */}
        <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Col gauche: Ingest + état job */}
          <section className="lg:col-span-1 space-y-4">
            <div
              ref={dropRef}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={classNames(
                "rounded-2xl border-2 border-dashed p-4 sm:p-6 bg-white transition",
                dragActive ? "border-blue-500 bg-blue-50" : "border-gray-200"
              )}
            >
              <h2 className="text-lg font-medium mb-2">Déposer vos documents</h2>
              <p className="text-sm text-gray-600 mb-3">
                Glissez-déposez un <b>.zip</b> ou plusieurs fichiers (.pdf, .docx, .txt, .md).  
                Pour de gros volumes, préférez un <b>ZIP</b>.
              </p>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={onPickZip}
                  disabled={zipUploading}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50"
                >
                  {zipUploading ? "Envoi ZIP…" : "Choisir un .zip"}
                </button>
                <button
                  onClick={onPickFiles}
                  disabled={filesUploading}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-900 text-white disabled:opacity-50"
                >
                  {filesUploading ? "Envoi fichiers…" : "Choisir fichiers"}
                </button>
                <input
                  ref={inputZipRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={onZipChange}
                />
                <input
                  ref={inputFilesRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onFilesChange}
                />
              </div>

              {lastJobId ? (
                <div className="mt-4 p-3 rounded-xl bg-gray-50 border">
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium">Job #{lastJobId.slice(0, 8)}…</div>
                    <div className={classNames(
                      "px-2 py-0.5 rounded-full",
                      job?.status === "done" ? "bg-green-100 text-green-700" :
                      job?.status === "error" ? "bg-red-100 text-red-700" :
                      "bg-blue-100 text-blue-700"
                    )}>
                      {job?.status || "en attente…"}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={classNames(
                          "h-2 rounded-full transition-all",
                          job?.status === "error" ? "bg-red-500" : "bg-blue-600"
                        )}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-gray-600">
                      {job?.processed_files || 0} / {job?.total_files || 0} fichiers ({progressPct}%)
                    </div>
                    {job?.error && (
                      <div className="mt-2 text-xs text-red-600 break-words">
                        {job.error}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-gray-500">
                  Aucun job en cours. Après import, l’indexation se lance automatiquement.
                </div>
              )}
            </div>

            <div className="rounded-2xl border p-4 bg-white">
              <h3 className="font-medium mb-2">Conseils</h3>
              <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
                <li>Préférez un <b>ZIP</b> pour des milliers de fichiers.</li>
                <li>Formats pris en charge : PDF, DOCX, TXT, MD.</li>
                <li>Vous pouvez réimporter pour mettre à jour l’index.</li>
              </ul>
            </div>
          </section>

          {/* Col droite: Search + Ask */}
          <section className="lg:col-span-2 space-y-4">
            {/* SEARCH */}
            <div className={classNames("rounded-2xl border bg-white p-4", tab !== "search" && "opacity-95")}>
              <h2 className="text-lg font-medium">Rechercher</h2>
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ex : politique de validation GMP"
                  className="w-full px-3 py-2 rounded-xl border focus:outline-none"
                />
                <button
                  onClick={runSearch}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 text-white"
                >
                  Chercher
                </button>
              </div>

              {matches?.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium mb-2">Passages les plus pertinents</h3>
                  <ul className="space-y-3">
                    {matches.map((m, i) => (
                      <li key={i} className="p-3 rounded-xl border bg-gray-50">
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">
                          {m.snippet}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {m.meta?.filename}
                          {typeof m.meta?.pages === "number" ? ` (pages: ${m.meta.pages})` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* ASK */}
            <div className={classNames("rounded-2xl border bg-white p-4", tab !== "ask" && "opacity-95")}>
              <h2 className="text-lg font-medium">Poser une question</h2>
              <div className="mt-2">
                <textarea
                  rows={4}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Tapez votre question… (ex : Quels sont les contrôles GxP exigés pour les change controls ?)"
                  className="w-full px-3 py-2 rounded-xl border focus:outline-none"
                />
              </div>
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <button
                  onClick={runAsk}
                  disabled={loadingAnswer}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-900 text-white disabled:opacity-50"
                >
                  {loadingAnswer ? "Génération…" : "Demander à Ask Veeva"}
                </button>
                <button
                  onClick={() => setAnswer(null)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-200"
                >
                  Effacer
                </button>
              </div>

              {answer && (
                <div className="mt-4 space-y-3">
                  {answer.error && (
                    <div className="text-red-600 text-sm">Erreur : {answer.error}</div>
                  )}
                  {answer.text && (
                    <div className="prose max-w-none">
                      <p className="whitespace-pre-wrap">{answer.text}</p>
                    </div>
                  )}
                  {answer.citations?.length ? (
                    <div className="pt-2 border-t">
                      <h3 className="text-sm font-medium mb-1">Citations</h3>
                      <ul className="text-sm list-disc pl-5">
                        {answer.citations.map((c, i) => (
                          <li key={i}>{c.filename}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
