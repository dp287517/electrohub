// src/pages/Ask_veeva.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  health,
  ask,
  // search as apiSearch, // (optionnel) encore dispo si tu veux un onglet "Recherche"
  uploadSmall,
  chunkedUpload,
  pollJob,
  buildFileURL,
  // buildStreamURL, // supprimé : pas d'endpoint /stream côté serveur
  findDocs, // garde en try/catch (endpoint pas encore implémenté côté serveur)
} from "../utils/ask_veeva.js";

/* ------------------------- Petits utilitaires UI ------------------------- */
function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
}
const copy = async (s) => {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
};
const isVideoFilename = (name = "") =>
  /\.(mp4|mov|m4v|webm)$/i.test(name);

/* --------------------------------- UI bits -------------------------------- */
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-4 py-2 rounded-t-lg text-sm font-medium",
        active ? "bg-white border-x border-t border-gray-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function CitationChips({ citations, onPeek }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {citations.map((c, i) => (
        <button
          key={i}
          onClick={() => onPeek?.(c)}
          className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
          title={`${c.filename} • score: ${c.score?.toFixed?.(3)}`}
        >
          {c.filename}
        </button>
      ))}
    </div>
  );
}

function Message({ role, text, citations, onPeek }) {
  const isUser = role === "user";
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[95%] sm:max-w-[75%] md:max-w-[65%] rounded-2xl px-4 py-3 shadow",
          isUser ? "bg-blue-600 text-white rounded-br-sm" : "bg-white text-gray-800 rounded-bl-sm border"
        )}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
        {!isUser && <CitationChips citations={citations} onPeek={onPeek} />}
      </div>
    </div>
  );
}

/* --------------------------- Sidebar (multi-focus) --------------------------- */
function SidebarContexts({
  contexts,
  selected,
  toggleSelect,
  selectOnly,
  clearSelection,
  onAskSelected,
  onPeek,
  onOpen,
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-base">Documents du contexte</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{selected.size} sélectionné(s)</span>
          <button
            onClick={onAskSelected}
            disabled={!selected.size}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Re-poser (focus)
          </button>
          {!!selected.size && (
            <button
              onClick={clearSelection}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
            >
              Vider
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 overflow-auto pr-1">
        {!contexts?.length && (
          <div className="text-sm text-gray-500">Aucun document dans le contexte.</div>
        )}
        {contexts?.map((d) => {
          const checked = selected.has(d.doc_id);
          return (
            <div key={d.doc_id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => toggleSelect(d.doc_id)}
                  title="Ajouter/retirer du focus multiple"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[13px] break-words whitespace-break-spaces leading-snug">
                    {d.filename}
                  </div>
                  <div className="mt-2 text-[12px] text-gray-700 space-y-1">
                    {d.chunks?.slice(0, 4).map((c, i) => (
                      <div key={i} className="border-l-2 border-gray-200 pl-2">
                        <div className="text-gray-400"># {c.chunk_index}</div>
                        <div className="break-words whitespace-break-spaces">
                          {c.snippet}
                        </div>
                      </div>
                    ))}
                    {d.chunks && d.chunks.length > 4 && (
                      <div className="text-[11px] text-gray-400">
                        +{d.chunks.length - 4} autres extraits…
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => selectOnly(d.doc_id)}
                  className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                >
                  Focus seul
                </button>
                <button
                  onClick={() => onPeek?.({ doc_id: d.doc_id, filename: d.filename })}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                >
                  Aperçu
                </button>
                <button
                  onClick={() => onOpen?.({ doc_id: d.doc_id, filename: d.filename })}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                >
                  Ouvrir
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------- Viewer pane ------------------------------- */
function Viewer({ file, onClose }) {
  if (!file) return null;

  const fileURL = buildFileURL(file.doc_id);
  const looksVideo = isVideoFilename(file.filename);

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="min-w-0 pr-2">
            <div className="text-sm text-gray-500">Prévisualisation</div>
            <div className="font-medium text-[13px] break-words whitespace-break-spaces">{file.filename}</div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={fileURL}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
              title="Ouvrir dans un nouvel onglet"
            >
              Ouvrir l’original
            </a>
            <button
              onClick={() => copy(fileURL)}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
              title="Copier l’URL"
            >
              Copier l’URL
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {looksVideo ? (
            <div className="w-full h-full p-2">
              <video src={fileURL} controls className="w-full h-[70vh] max-h-full" />
            </div>
          ) : (
            <iframe
              title="preview"
              src={fileURL}
              className="w-full h-[80vh]"
              loading="eager"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Chat Box -------------------------------- */
function ChatBox() {
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [k, setK] = useState(6); // valeur par défaut alignée backend
  const [contexts, setContexts] = useState([]); // [{doc_id, filename, chunks:[]}]
  const [selectedDocs, setSelectedDocs] = useState(() => new Set());
  const [suggestions, setSuggestions] = useState([]);
  const [viewerFile, setViewerFile] = useState(null);

  const listRef = useRef(null);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = sessionStorage.getItem("askVeeva_chat");
      return raw ? JSON.parse(raw) : [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    } catch {
      return [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    }
  });

  useEffect(() => {
    sessionStorage.setItem("askVeeva_chat", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = await health();
        if (alive) setReady(!!h?.ok);
      } catch {
        setReady(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  function toggleSelect(docId) {
    setSelectedDocs((prev) => {
      const n = new Set(prev);
      if (n.has(docId)) n.delete(docId);
      else n.add(docId);
      return n;
    });
  }
  function selectOnly(docId) {
    setSelectedDocs(new Set([docId]));
  }
  function clearSelection() {
    setSelectedDocs(new Set());
  }

  async function runAsk(q, docFilter = []) {
    setSending(true);
    try {
      // Le backend n’accepte que {question,k,docFilter} (pas history/wantVideos)
      const resp = await ask(q, k, docFilter);
      const text = resp?.text || "Désolé, aucune réponse.";
      const citations = (resp?.citations || []).map((c) => ({
        filename: c.filename,
        score: c.score,
        doc_id: c.doc_id,
      }));
      setMessages((m) => [...m, { role: "assistant", text, citations }]);
      setContexts(resp?.contexts || []);
      setSuggestions(resp?.suggestions || []);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Une erreur est survenue : ${e?.message || e}` }]);
    } finally {
      setSending(false);
    }
  }

  async function onSend() {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    const docFilter = selectedDocs.size ? Array.from(selectedDocs) : [];
    await runAsk(q, docFilter);
  }

  function quickAsk(s) {
    setInput(s);
    setTimeout(onSend, 10);
  }

  async function onAskSelected() {
    const lastQ =
      [...messages].reverse().find((m) => m.role === "user")?.text ||
      input ||
      "Peux-tu détailler ?";
    if (!selectedDocs.size) return;
    setMessages((m) => [...m, { role: "user", text: `${lastQ} (focus multi)` }]);
    await runAsk(lastQ, Array.from(selectedDocs));
  }

  async function handlePeek(c) {
    setViewerFile({ doc_id: c.doc_id, filename: c.filename });
  }
  function handleOpen(c) {
    window.open(buildFileURL(c.doc_id), "_blank", "noopener");
  }

  async function tryDidYouMean(q) {
    if (!q || q.length < 3) return;
    try {
      const ret = await findDocs(q);
      if (ret?.items?.length) {
        setSuggestions(ret.items.slice(0, 8).map((it) => it.filename));
      }
    } catch {
      // endpoint pas dispo : ignorer silencieusement
    }
  }

  function onClearChat() {
    try {
      sessionStorage.removeItem("askVeeva_chat");
    } catch {}
    setMessages([{ role: "assistant", text: "Conversation réinitialisée. Posez votre question." }]);
    setContexts([]);
    setSelectedDocs(new Set());
    setSuggestions([]);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bandeau */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-600 flex items-center gap-2">
          <span>{ready ? "Connecté" : "Hors-ligne"} •</span>
          <label className="flex items-center gap-1">
            <span>Top-K</span>
            <select
              className="border rounded px-1 py-0.5 text-sm"
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
              title="Nombre de passages contextuels"
            >
              {[6, 10, 20, 40].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearChat}
            className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
          >
            Supprimer la conversation
          </button>
          <div className="hidden sm:flex gap-2">
            {[
              "Montre-moi les SOP PPE",
              "Quelles sont les étapes de validation ?",
              "Où est la dernière version ?",
            ].map((s, i) => (
              <button
                key={i}
                onClick={() => quickAsk(s)}
                className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Layout 2 colonnes : Chat (2fr) | Sidebar (1fr) */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        {/* Chat */}
        <div className="flex flex-col">
          <div
            ref={listRef}
            className="h-[52vh] sm:h-[60vh] xl:h-[66vh] overflow-auto space-y-3 p-2 bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg border"
          >
            {messages.map((m, i) => (
              <Message key={i} role={m.role} text={m.text} citations={m.citations} onPeek={handlePeek} />
            ))}
            {sending && <div className="text-xs text-gray-500 animate-pulse px-2">Ask Veeva rédige…</div>}
          </div>

          {/* Saisie + suggestions */}
          {!!suggestions.length && (
            <div className="mt-2 flex items-start gap-2 flex-wrap">
              <div className="text-xs text-gray-600 mt-1">Vouliez-vous dire :</div>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => quickAsk(s)}
                  className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                  title="Lancer une recherche avec ce terme"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end gap-2">
            <textarea
              rows={2}
              className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={selectedDocs.size ? "Votre question (focus multi activé)..." : "Posez votre question…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              onBlur={() => tryDidYouMean(input)}
              disabled={!ready || sending}
            />
            <button
              onClick={onSend}
              disabled={!ready || sending || !input.trim()}
              className="h-10 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="min-h-0">
          <div className="border rounded-lg p-3 bg-white h-[52vh] sm:h-[60vh] xl:h-[66vh] overflow-hidden">
            <SidebarContexts
              contexts={contexts}
              selected={selectedDocs}
              toggleSelect={toggleSelect}
              selectOnly={selectOnly}
              clearSelection={clearSelection}
              onAskSelected={onAskSelected}
              onPeek={handlePeek}
              onOpen={handleOpen}
            />
          </div>
        </aside>
      </div>

      {/* Viewer modal */}
      <Viewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </div>
  );
}

/* -------------------------------- Import box ------------------------------- */
function ImportBox() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [job, setJob] = useState(null);
  const [log, setLog] = useState([]);

  const canUpload = useMemo(() => !!file && !busy, [file, busy]);

  function appendLog(s) {
    setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${s}`]);
  }

  async function onUpload() {
    if (!file) return;
    setBusy(true);
    setProgress(null);
    setJob(null);
    setLog([]);

    try {
      const isZip = /\.zip$/i.test(file.name);
      if (isZip && file.size > 280 * 1024 * 1024) {
        appendLog("Gros ZIP détecté : envoi fractionné…");
        const ret = await chunkedUpload(file, {
          onProgress: ({ uploadedBytes, totalBytes }) => {
            setProgress(Math.round((uploadedBytes / totalBytes) * 100));
          },
        });
        if (!ret?.job_id) throw new Error("Chunked terminé mais job_id vide");
        appendLog(`Job créé : ${ret.job_id}`);
        await followJob(ret.job_id);
      } else {
        appendLog("Envoi direct…");
        const ret = await uploadSmall(file);
        if (!ret?.job_id) throw new Error("Upload OK mais job_id vide");
        appendLog(`Job créé : ${ret.job_id}`);
        await followJob(ret.job_id);
      }
    } catch (e) {
      appendLog(`ERREUR: ${e?.message || e}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function followJob(jobId) {
    setJob({ id: jobId, status: "queued" });
    const p = pollJob(jobId, { onTick: (j) => setJob(j) });
    const done = await p.promise;
    if (done?.status === "done") appendLog("✅ Ingestion terminée.");
    else if (done?.status === "error") appendLog(`❌ Ingestion en erreur: ${done?.error || "inconnue"}`);
  }

  return (
    <div className="space-y-4">
      <div
        className="border-2 border-dashed rounded-xl p-6 text-center bg-white"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <div className="text-lg font-medium">Importer des documents</div>
        <div className="text-sm text-gray-500 mt-1">
          Formats pris en charge : ZIP, PDF, DOCX, XLSX/XLS, CSV, TXT, MP4/WEBM/MOV.
        </div>
        <div className="mt-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer">
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            Choisir un fichier…
          </label>
        </div>
        {file && (
          <div className="mt-3 text-sm text-gray-700 break-all">
            Fichier : <span className="font-medium">{file.name}</span>{" "}
            <span className="text-gray-500">({(file.size / (1024 * 1024)).toFixed(1)} Mo)</span>
          </div>
        )}
        <div className="mt-4">
          <button
            onClick={onUpload}
            disabled={!canUpload}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Importer
          </button>
        </div>
        {progress !== null && (
          <div className="mt-4">
            <div className="w-full h-2 bg-gray-200 rounded">
              <div className="h-2 bg-blue-600 rounded" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-gray-600 mt-1">{progress}%</div>
          </div>
        )}
      </div>

      {job && (
        <div className="p-4 border rounded-lg bg-white">
          <div className="text-sm text-gray-600">Job</div>
          <div className="font-mono text-xs break-all">{job.id}</div>
          <div className="mt-1 text-sm">
            Statut:{" "}
            <span
              className={
                job.status === "done"
                  ? "text-green-700"
                  : job.status === "error"
                  ? "text-red-700"
                  : "text-gray-700"
              }
            >
              {job.status}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            Fichiers : {job.processed_files}/{job.total_files}
          </div>
          {job.error && <div className="text-sm text-red-700 mt-1">{job.error}</div>}
        </div>
      )}

      {!!log.length && (
        <div className="p-3 border rounded-lg bg-gray-50 text-xs font-mono space-y-1 max-h-48 overflow-auto">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */
export default function AskVeevaPage() {
  const [tab, setTab] = useState("chat"); // 'chat' | 'import'

  return (
    <section className="max-w-[1400px] 2xl:max-w-[1600px] mx-auto px-3 sm:px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva</h1>
      </div>

      <div className="flex gap-2">
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
          Recherche IA
        </TabButton>
        <TabButton active={tab === "import"} onClick={() => setTab("import")}>
          Import
        </TabButton>
      </div>

      <div className="border border-t-0 rounded-b-lg rounded-tr-lg bg-white p-4">
        {tab === "chat" ? <ChatBox /> : <ImportBox />}
      </div>
    </section>
  );
}
