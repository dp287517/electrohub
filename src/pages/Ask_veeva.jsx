// src/pages/Ask_veeva.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { uploadZipMultipartS3, uploadZipSmall } from "../utils/ask_veeva.js";

const BYTES_IN_MB = 1024 * 1024;
const SMALL_UPLOAD_LIMIT_MB = 100; // au-delà => multipart S3

function PrettyBytes({ value }) {
  const [num, unit] = useMemo(() => {
    if (!value && value !== 0) return ["", ""];
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = value;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return [v.toFixed(v < 10 ? 2 : 1), units[i]];
  }, [value]);
  return <span>{num} {unit}</span>;
}

function JobProgress({ jobId }) {
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const j = await api.askVeeva.job(jobId);
        if (!cancelled) setJob(j);
        if (!cancelled && j && (j.status === "queued" || j.status === "running")) {
          timer.current = setTimeout(poll, 1500);
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
        timer.current = setTimeout(poll, 2500);
      }
    }
    poll();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [jobId]);

  if (err) {
    return (
      <div className="mt-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
        Erreur de suivi du job: {err}
      </div>
    );
  }
  if (!job) return null;

  const pct = job.total_files > 0
    ? Math.round((job.processed_files / job.total_files) * 100)
    : job.status === "done" ? 100 : 0;

  return (
    <div className="mt-4 p-4 rounded-lg border bg-white">
      <div className="flex items-center justify-between">
        <div className="font-medium">Job: {job.id}</div>
        <div className={`text-xs px-2 py-1 rounded ${job.status === 'done' ? 'bg-green-100 text-green-800' : job.status === 'error' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
          {job.status}
        </div>
      </div>
      <div className="mt-3">
        <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
          <div className="h-2 bg-blue-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-sm text-gray-600">
          {job.processed_files}/{job.total_files} fichiers
          {job.error ? <span className="ml-2 text-red-600">— {job.error}</span> : null}
        </div>
      </div>
    </div>
  );
}

export default function AskVeevaPage() {
  const [health, setHealth] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [jobId, setJobId] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const dropRef = useRef(null);

  function appendLog(s) { setLog(prev => (prev ? prev + "\n" : "") + s); }

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

  // Drag & drop
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onDragOver = (e) => { e.preventDefault(); el.classList.add("ring-2", "ring-blue-500"); };
    const onDragLeave = (e) => { e.preventDefault(); el.classList.remove("ring-2", "ring-blue-500"); };
    const onDrop = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-blue-500");
      const f = e.dataTransfer.files?.[0];
      if (f) setFile(f);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  async function doUpload() {
    if (!file) return;
    setBusy(true); setLog(""); setJobId(""); setAnswer(null); setSearchRes([]);

    const sizeMB = file.size / BYTES_IN_MB;
    try {
      if (sizeMB > SMALL_UPLOAD_LIMIT_MB) {
        appendLog(`Mode S3 multipart (fichier ${sizeMB.toFixed(1)} MB)`);
        const out = await uploadZipMultipartS3(file, (p) => {
          appendLog(`Upload part ${p.part}/${p.totalParts} — ${p.progress.toFixed(1)}%`);
        });
        setJobId(out.job_id);
        appendLog(`Job soumis: ${out.job_id}`);
      } else {
        appendLog(`Mode upload direct (<= ${SMALL_UPLOAD_LIMIT_MB} MB)`);
        const out = await uploadZipSmall(file);
        setJobId(out.job_id);
        appendLog(`Job soumis: ${out.job_id}`);
      }
    } catch (e) {
      // Si le backend a renvoyé une page HTML (500), on affiche un message propre
      const msg = (e && e.message) ? e.message : String(e);
      appendLog(`Erreur: ${msg}`);
      alert(`Upload ZIP échoué: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function doSearch() {
    setSearchRes([]); setAnswer(null);
    if (!searchQ.trim()) return;
    try {
      const r = await api.askVeeva.search({ query: searchQ, k: 6 });
      setSearchRes(r.matches || []);
    } catch (e) {
      alert(`Search error: ${e.message || String(e)}`);
    }
  }

  async function doAsk() {
    setAnswer(null); setSearchRes([]);
    if (!question.trim()) return;
    try {
      const r = await api.askVeeva.ask({ question, k: 6 });
      setAnswer(r);
    } catch (e) {
      alert(`Ask error: ${e.message || String(e)}`);
    }
  }

  return (
    <section className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva — Lecture & Q/R sur documents</h1>
        <p className="text-gray-600 mt-2 text-sm sm:text-base">
          Dépose un <strong>ZIP</strong> (ou utilise l’upload multipart S3 pour les gros fichiers), puis pose ta question.
        </p>
        {health && (
          <div className={`mt-3 text-sm px-3 py-2 rounded ${health.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {health.ok
              ? <>OK — embeddings: <code>{health.embeddings}</code>, modèle: <code>{health.model}</code></>
              : <>Backend indisponible : {health.error}</>
            }
          </div>
        )}
      </header>

      {/* Upload */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 rounded-lg border bg-white">
          <div
            ref={dropRef}
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer bg-gray-50"
            onClick={() => document.getElementById("zipInput").click()}
          >
            <input
              id="zipInput"
              className="hidden"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {!file ? (
              <div>
                <div className="text-4xl mb-2">📦</div>
                <div className="font-medium">Glisser-déposer un ZIP ici</div>
                <div className="text-sm text-gray-600">ou cliquer pour parcourir</div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">{file.name}</div>
                <div className="text-sm text-gray-600">
                  Taille: <PrettyBytes value={file.size} />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button
              disabled={!file || busy}
              onClick={doUpload}
              className="inline-flex items-center justify-center px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Envoi en cours..." : "Uploader & indexer"}
            </button>
            <div className="text-xs text-gray-500 sm:ml-2">
              &gt; {SMALL_UPLOAD_LIMIT_MB} Mo → **S3 multipart** (recommandé pour gros ZIP)
            </div>
          </div>

          {!!log && (
            <pre className="mt-3 text-xs bg-gray-50 p-2 rounded overflow-auto max-h-40">{log}</pre>
          )}

          {jobId && <JobProgress jobId={jobId} />}
        </div>

        {/* Recherche & Q/R */}
        <div className="p-4 rounded-lg border bg-white">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Recherche rapide</label>
              <div className="mt-1 flex gap-2">
                <input
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  placeholder="ex: 'procédure veeva lot release'"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                />
                <button onClick={doSearch} className="px-3 py-2 text-sm rounded bg-gray-800 text-white hover:bg-black">
                  Rechercher
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Question libre</label>
              <textarea
                className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[90px]"
                placeholder="Pose n'importe quelle question…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <div className="mt-2">
                <button onClick={doAsk} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                  Demander
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Résultats */}
      {searchRes?.length > 0 && (
        <div className="mt-6 p-4 rounded-lg border bg-white">
          <div className="font-medium mb-3">Résultats</div>
          <ul className="space-y-3">
            {searchRes.map((m, idx) => (
              <li key={idx} className="p-3 rounded border">
                <div className="text-sm text-gray-500 mb-1">{m.meta?.filename}</div>
                <div className="text-sm whitespace-pre-wrap">{m.snippet}</div>
                <div className="mt-1 text-xs text-gray-400">score: {m.score?.toFixed?.(3)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer && (
        <div className="mt-6 p-4 rounded-lg border bg-white">
          <div className="font-medium mb-2">Réponse</div>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">{answer.text}</div>
          {answer.citations?.length ? (
            <div className="mt-3 text-xs text-gray-500">
              Sources: {answer.citations.map((c,i) => <span key={i} className="mr-2">{c.filename}</span>)}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
