// src/pages/Ask_veeva.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  health,
  ask,
  find,            // <= utils/ask_veeva.js doit exposer find(query, limit)
  uploadSmall,
  chunkedUpload,
  pollJob,
} from "../utils/ask_veeva.js";

/* ------------------------------ helpers UI ------------------------------ */

function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
}

function guessKindFromFilename(name = "") {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "md"].includes(ext)) return "doc";
  return "other";
}

/* ------------------------------ UI atoms ------------------------------ */

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 sm:px-4 py-2 rounded-t-lg text-sm font-medium transition",
        active
          ? "bg-white border-x border-t border-gray-200"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function CitationChips({ citations, onOpenDoc }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {citations.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpenDoc?.(c)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
          title={`score: ${c.score?.toFixed?.(3) ?? "-"}`}
        >
          <span className="i-mdi-eye text-[13px]" aria-hidden>👁</span>
          <span className="truncate max-w-[14rem]" title={c.filename}>{c.filename}</span>
        </button>
      ))}
    </div>
  );
}

function Message({ role, text, citations, onOpenDoc }) {
  const isUser = role === "user";
  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[92%] sm:max-w-[78%] lg:max-w-[70%] rounded-2xl px-4 py-3 shadow leading-relaxed",
          isUser
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-white text-gray-900 rounded-bl-sm border"
        )}
      >
        <div className="whitespace-pre-wrap break-words">{text}</div>
        {!isUser && (
          <CitationChips citations={citations} onOpenDoc={onOpenDoc} />
        )}
      </div>
    </div>
  );
}

/* --------------------------- Recherche globale -------------------------- */

function GlobalSearch({ onPickDoc }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  async function onSearch(e) {
    e?.preventDefault?.();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setItems([]);
    setSuggestions([]);
    try {
      const res = await find(query, 120); // backend: hybride (filename fuzzy + trgm)
      setItems(res?.items || []);
      setSuggestions(res?.suggestions || []);
    } catch (e) {
      setItems([]);
      setSuggestions([]);
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Rechercher un document ou une vidéo… (ex: N2000-2, vignette TnT, 'vignetteuse')"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="px-3 sm:px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
          disabled={!q.trim() || busy}
        >
          Rechercher
        </button>
      </form>

      {suggestions?.length > 0 && (
        <div className="text-xs text-gray-700">
          Vouliez-vous dire&nbsp;:
          <div className="mt-1 flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setQ(s);
                  setTimeout(onSearch, 0);
                }}
                className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-100"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {!!items.length && (
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {items.map((it) => {
            const kind = guessKindFromFilename(it.filename);
            return (
              <div
                key={it.doc_id}
                className="flex items-center justify-between gap-2 border rounded-lg p-2 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" title={it.filename}>
                    {it.filename}
                  </div>
                  <div className="text-xs text-gray-500">
                    {kind === "video" ? "Vidéo" : kind === "pdf" ? "PDF" : "Document"}
                    {typeof it.score === "number" && (
                      <> • score ~ {it.score.toFixed(2)}</>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onPickDoc?.(it)}
                  className="shrink-0 text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Ouvrir
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Sidebar contexte ----------------------------- */

function SidebarContexts({ contexts, activeDocId, onFocusDoc, onOpenDoc }) {
  if (!contexts?.length) {
    return (
      <div className="text-sm text-gray-500">
        Aucun document dans le contexte. Utilisez la recherche ci-dessous pour ouvrir un fichier/vidéo.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {contexts.map((d) => {
        const active = d.doc_id === activeDocId;
        return (
          <div
            key={d.doc_id}
            className={clsx("border rounded-lg p-3", active ? "border-indigo-400 bg-indigo-50" : "bg-white")}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate" title={d.filename}>
                {d.filename}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onOpenDoc?.({ doc_id: d.doc_id, filename: d.filename })}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                  title="Ouvrir dans le viewer"
                >
                  👁 Ouvrir
                </button>
                <button
                  onClick={() => onFocusDoc?.(d.doc_id)}
                  className={clsx(
                    "text-xs px-2 py-1 rounded",
                    active ? "bg-indigo-600 text-white" : "bg-gray-100 hover:bg-gray-200"
                  )}
                >
                  {active ? "Focalisé" : "Focus"}
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              {d.chunks?.slice(0, 3).map((c, i) => (
                <div key={i} className="mb-1">
                  <span className="inline-block min-w-10 text-gray-400">#{c.chunk_index ?? "–"}</span>
                  <span className="opacity-80">{c.snippet}</span>
                </div>
              ))}
              {d.chunks && d.chunks.length > 3 && (
                <div className="text-[11px] text-gray-400">+{d.chunks.length - 3} autres extraits…</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Viewer panel ------------------------------- */

function Viewer({ doc, onClose }) {
  if (!doc) {
    return (
      <div className="h-full border rounded-lg bg-white flex items-center justify-center text-sm text-gray-500">
        Sélectionnez un document ou une vidéo à droite/ci-dessous.
      </div>
    );
  }
  const { doc_id, filename } = doc;
  const kind = guessKindFromFilename(filename || "");
  const fileUrl = `/api/ask-veeva/file/${doc_id}`;
  const streamUrl = `/api/ask-veeva/stream/${doc_id}`;

  return (
    <div className="h-full border rounded-lg bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
        <div className="truncate font-medium text-sm" title={filename}>{filename}</div>
        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
            title="Ouvrir dans un nouvel onglet"
          >
            ↗ Ouvrir
          </a>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {kind === "video" ? (
          <video
            controls
            src={streamUrl}
            className="w-full h-full rounded-b-lg"
            style={{ height: "calc(100% - 0px)" }}
          />
        ) : kind === "pdf" ? (
          <object
            data={fileUrl}
            type="application/pdf"
            className="w-full h-full"
          >
            <div className="p-4 text-sm">
              Le PDF ne peut pas être affiché.{" "}
              <a className="text-blue-600 underline" href={fileUrl} target="_blank" rel="noreferrer">
                Ouvrir le fichier
              </a>
            </div>
          </object>
        ) : (
          <iframe
            title="document"
            src={fileUrl}
            className="w-full h-full"
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Chat box -------------------------------- */

function ChatBox() {
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [contexts, setContexts] = useState([]);          // pour la sidebar
  const [activeDocId, setActiveDocId] = useState(null);  // doc focalisé
  const [viewerDoc, setViewerDoc] = useState(null);      // doc ouvert dans le viewer
  const [askSuggestions, setAskSuggestions] = useState([]); // “Vouliez-vous dire…?”
  const listRef = useRef(null);

  const [messages, setMessages] = useState(() => {
    try {
      const raw = sessionStorage.getItem("askVeeva_chat");
      return raw ? JSON.parse(raw) : [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    } catch {
      return [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    }
  });

  // persist chat
  useEffect(() => {
    try {
      sessionStorage.setItem("askVeeva_chat", JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // health
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
    return () => { alive = false; };
  }, []);

  // auto-scroll
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function runAsk(q, docFilter = []) {
    setSending(true);
    setAskSuggestions([]);
    try {
      // on envoie un historique court (mémoire de la conversation, 12 derniers)
      const history = messages.slice(-12).map(m => ({
        role: m.role,
        text: m.text,
      }));
      const resp = await ask(q, /*k*/ 12, docFilter, history);

      const text = resp?.text || "Désolé, aucune réponse.";
      const citations = (resp?.citations || []).map((c) => ({
        doc_id: c.doc_id,
        filename: c.filename,
        score: c.score,
      }));
      setMessages((m) => [...m, { role: "assistant", text, citations }]);
      setContexts(resp?.contexts || []);
      if (docFilter?.length) setActiveDocId(docFilter[0]);
      setAskSuggestions(resp?.suggestions || []);
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
    await runAsk(q, activeDocId ? [activeDocId] : []);
  }

  function quickAsk(s) {
    setInput(s);
    setTimeout(onSend, 20);
  }

  function onClearChat() {
    try {
      sessionStorage.removeItem("askVeeva_chat");
    } catch {}
    setMessages([{ role: "assistant", text: "Conversation réinitialisée. Posez votre question." }]);
    setContexts([]);
    setActiveDocId(null);
    setAskSuggestions([]);
  }

  function openDoc(c) {
    if (!c?.doc_id) return;
    setViewerDoc({ doc_id: c.doc_id, filename: c.filename });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bandeau haut */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-700">
          {ready ? "Connecté" : "Hors-ligne"}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClearChat}
            className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
          >
            Supprimer la conversation
          </button>
          <div className="hidden sm:flex gap-2">
            {["Montre-moi les SOP PPE", "Quelles sont les étapes de validation ?", "Où est la dernière version ?"].map(
              (s, i) => (
                <button
                  key={i}
                  onClick={() => quickAsk(s)}
                  className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
                >
                  {s}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* 3 colonnes responsive : Chat (2) • Sidebar (1) • Viewer (2) */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Chat */}
        <div className="xl:col-span-2">
          <div
            ref={listRef}
            className="min-h-[48vh] md:min-h-[54vh] xl:h-[calc(100vh-260px)] overflow-auto space-y-3 p-2 bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg border"
          >
            {messages.map((m, i) => (
              <Message
                key={i}
                role={m.role}
                text={m.text}
                citations={m.citations}
                onOpenDoc={openDoc}
              />
            ))}
            {sending && <div className="text-xs text-gray-500 animate-pulse px-2">Ask Veeva rédige…</div>}
          </div>

          {/* Suggestions “vouliez-vous dire” */}
          {!!askSuggestions.length && (
            <div className="mt-2 text-xs text-gray-700">
              Vouliez-vous dire&nbsp;:
              <div className="mt-1 flex flex-wrap gap-2">
                {askSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(s);
                      setTimeout(onSend, 20);
                    }}
                    className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Saisie */}
          <div className="mt-3 flex items-end gap-2">
            <textarea
              rows={2}
              className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={activeDocId ? "Votre question (focus sur le doc sélectionné)..." : "Posez votre question…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
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

        {/* Sidebar Contexte + Recherche */}
        <aside className="xl:col-span-1">
          <div className="border rounded-lg p-3 bg-white xl:h-[calc(100vh-260px)] min-h-[48vh] overflow-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Documents du contexte</h3>
              {activeDocId && (
                <button className="text-xs text-indigo-700 underline" onClick={() => setActiveDocId(null)}>
                  Retirer le focus
                </button>
              )}
            </div>
            <SidebarContexts
              contexts={contexts}
              activeDocId={activeDocId}
              onFocusDoc={(docId) => setActiveDocId(docId)}
              onOpenDoc={(doc) => setViewerDoc({ doc_id: doc.doc_id, filename: doc.filename })}
            />
            <div className="pt-2 border-t" />
            <GlobalSearch
              onPickDoc={(it) => setViewerDoc({ doc_id: it.doc_id, filename: it.filename })}
            />
          </div>
        </aside>

        {/* Viewer */}
        <div className="xl:col-span-2">
          <div className="xl:h-[calc(100vh-260px)] min-h-[48vh]">
            <Viewer
              doc={viewerDoc}
              onClose={() => setViewerDoc(null)}
            />
          </div>
        </div>
      </div>
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
    const p = pollJob(jobId, {
      onTick: (j) => setJob(j),
    });
    const done = await p.promise;
    if (done?.status === "done") {
      appendLog("✅ Ingestion terminée.");
    } else if (done?.status === "error") {
      appendLog(`❌ Ingestion en erreur: ${done?.error || "inconnue"}`);
    }
  }

  return (
    <div className="space-y-4">
      {/* Dropzone + input */}
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
          Formats pris en charge : ZIP, PDF, DOCX, XLSX/XLS, CSV, TXT, MP4.
        </div>
        <div className="mt-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer">
            <input
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            Choisir un fichier…
          </label>
        </div>
        {file && (
          <div className="mt-3 text-sm text-gray-700">
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

      {/* Job status */}
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

      {/* Logs */}
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

/* ----------------------------------- Page ---------------------------------- */

export default function AskVeevaPage() {
  const [tab, setTab] = useState("chat"); // 'chat' | 'import'

  return (
    <section className="mx-auto w-full max-w-[1760px] px-3 sm:px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva</h1>
      </div>

      {/* Onglets */}
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
