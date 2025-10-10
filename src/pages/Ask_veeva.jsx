// src/pages/Ask_veeva.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { health, search, ask, uploadSmall, chunkedUpload, pollJob } from "../utils/ask_veeva.js";

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 rounded-t-lg text-sm font-medium " +
        (active
          ? "bg-white border-x border-t border-gray-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200")
      }
    >
      {children}
    </button>
  );
}

function CitationChips({ citations }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {citations.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200"
          title={`score: ${c.score?.toFixed?.(3)}`}
        >
          {c.filename}
        </span>
      ))}
    </div>
  );
}

function Message({ role, text, citations }) {
  const isUser = role === "user";
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[90%] sm:max-w-[70%] md:max-w-[60%] rounded-2xl px-4 py-3 shadow " +
          (isUser ? "bg-blue-600 text-white rounded-br-sm" : "bg-white text-gray-800 rounded-bl-sm border")
        }
      >
        <div className="whitespace-pre-wrap break-words">{text}</div>
        {!isUser && <CitationChips citations={citations} />}
      </div>
    </div>
  );
}

/** ---------- Sidebar des documents / focus ---------- */
function SidebarContexts({ contexts, activeDocId, onFocusDoc, onAskDoc }) {
  if (!contexts?.length)
    return <div className="text-sm text-gray-500">Aucun document dans le contexte.</div>;

  return (
    <div className="space-y-3">
      {contexts.map((d) => {
        const active = d.doc_id === activeDocId;
        return (
          <div
            key={d.doc_id}
            className={"border rounded-lg p-3 " + (active ? "border-indigo-400 bg-indigo-50" : "bg-white")}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate" title={d.filename}>
                {d.filename}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onFocusDoc(d.doc_id)}
                  className={
                    "text-xs px-2 py-1 rounded " + (active ? "bg-indigo-600 text-white" : "bg-gray-100 hover:bg-gray-200")
                  }
                >
                  {active ? "Focalisé" : "Focus"}
                </button>
                <button
                  onClick={() => onAskDoc(d.doc_id)}
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Re-poser sur ce doc
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              {d.chunks?.slice(0, 3).map((c, i) => (
                <div key={i} className="mb-1">
                  <span className="inline-block min-w-10 text-gray-400">#{c.chunk_index}</span>
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

function ChatBox() {
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [k, setK] = useState(6);
  const [contexts, setContexts] = useState([]);          // ← données pour la sidebar
  const [activeDocId, setActiveDocId] = useState(null);  // ← doc focalisé
  const listRef = useRef(null);

  const [messages, setMessages] = useState(() => {
    // état persistant léger (sessionStorage) pour garder le fil si on quitte/retourne
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
    // auto-scroll
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function runAsk(q, docFilter = []) {
    setSending(true);
    try {
      const resp = await ask(q, k, docFilter); // ← patch: support docFilter
      const text = resp?.text || "Désolé, aucune réponse.";
      const citations = (resp?.citations || []).map((c) => ({
        filename: c.filename,
        score: c.score,
      }));
      setMessages((m) => [...m, { role: "assistant", text, citations }]);
      setContexts(resp?.contexts || []);
      if (docFilter?.length) setActiveDocId(docFilter[0]);
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
    // pour UX, on envoie directement
    setTimeout(onSend, 20);
  }

  function onClearChat() {
    try {
      sessionStorage.removeItem("askVeeva_chat");
    } catch {}
    setMessages([{ role: "assistant", text: "Conversation réinitialisée. Posez votre question." }]);
    setContexts([]);
    setActiveDocId(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bandeau haut */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-600 flex items-center gap-2">
          <span>{ready ? "Connecté" : "Hors-ligne"} •</span>
          <span>Top-K</span>
          <select
            className="border rounded px-1 py-0.5 text-sm"
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          >
            {[3, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
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

      {/* 2 colonnes responsive : chat + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chat (2/3) */}
        <div className="lg:col-span-2">
          <div
            ref={listRef}
            className="h-[50vh] sm:h-[60vh] lg:h-[64vh] overflow-auto space-y-3 p-2 bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg border"
          >
            {messages.map((m, i) => (
              <Message key={i} role={m.role} text={m.text} citations={m.citations} />
            ))}
            {sending && <div className="text-xs text-gray-500 animate-pulse px-2">Ask Veeva rédige…</div>}
          </div>

          {/* Saisie */}
          <div className="mt-3 flex items-end gap-2">
            <textarea
              rows={2}
              className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={activeDocId ? "Votre question (focus doc sélectionné)..." : "Posez votre question…"}
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

        {/* Sidebar (1/3) */}
        <aside className="lg:col-span-1">
          <div className="border rounded-lg p-3 bg-white h-[50vh] sm:h-[60vh] lg:h-[64vh] overflow-auto">
            <div className="flex items-center justify-between mb-2">
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
              onAskDoc={(docId) => {
                const lastQ =
                  [...messages].reverse().find((m) => m.role === "user")?.text ||
                  input ||
                  "Peux-tu détailler ?";
                setMessages((m) => [...m, { role: "user", text: `${lastQ} (focus: ${docId})` }]);
                runAsk(lastQ, [docId]);
              }}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

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
      // stratégie : si ZIP > 280 Mo → chunked; sinon upload direct
      const isZip = /\.zip$/i.test(file.name);
      if (isZip && file.size > 280 * 1024 * 1024) {
        appendLog("Gros ZIP détecté : envoi fractionné…");
        const ret = await chunkedUpload(file, {
          onProgress: ({ part, totalParts, uploadedBytes, totalBytes }) => {
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

export default function AskVeevaPage() {
  const [tab, setTab] = useState("chat"); // 'chat' | 'import'

  return (
    <section className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva</h1>
      </div>

      {/* onglets */}
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
