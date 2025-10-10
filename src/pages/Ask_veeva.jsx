// src/pages/Ask_veeva.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { health, ask, uploadSmall, chunkedUpload, pollJob } from "../utils/ask_veeva.js";

/* ===========================
   Petits helpers UI & URLs
   =========================== */
function cx(...list) {
  return list.filter(Boolean).join(" ");
}
const isVideoFilename = (name = "") => /\.(mp4|mov|m4v|webm)$/i.test(name);
const isPdfFilename = (name = "") => /\.pdf$/i.test(name);

/** Endpoints attendus côté backend pour servir les fichiers.
 *  Adapte les chemins si tu utilises d’autres routes.
 */
const buildFileUrl = (docId) => `/api/ask-veeva/file/${docId}`;
const buildStreamUrl = (docId) => `/api/ask-veeva/stream/${docId}`;

/* ===========================
   Composants UI
   =========================== */
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "px-4 py-2 rounded-t-lg text-sm font-medium transition-colors",
        active
          ? "bg-white border-x border-t border-gray-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function CitationChips({ citations, onOpen }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {citations.map((c, i) => (
        <button
          key={i}
          onClick={() => onOpen?.(c)}
          title={`score: ${c.score?.toFixed?.(3) ?? ""}`}
          className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
        >
          {c.filename}
        </button>
      ))}
    </div>
  );
}

function Message({ role, text, citations, onOpenCitation }) {
  const isUser = role === "user";
  return (
    <div className={cx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[92%] sm:max-w-[78%] md:max-w-[70%] xl:max-w-[62%] rounded-2xl px-4 py-3 shadow",
          isUser ? "bg-blue-600 text-white rounded-br-sm" : "bg-white text-gray-800 rounded-bl-sm border"
        )}
      >
        <div className="whitespace-pre-wrap break-words">{text}</div>
        {!isUser && (
          <CitationChips citations={citations} onOpen={onOpenCitation} />
        )}
      </div>
    </div>
  );
}

/* ===========================
   Viewer (Document / Vidéo)
   =========================== */
function ViewerPanel({ open, onClose, fileMeta }) {
  // fileMeta: { doc_id, filename, isVideo?, url, streamUrl? }
  if (!open) return null;

  const { doc_id, filename } = fileMeta || {};
  const url = fileMeta?.url ?? (doc_id ? buildFileUrl(doc_id) : null);
  const streamUrl = fileMeta?.streamUrl ?? (doc_id ? buildStreamUrl(doc_id) : null);
  const isVideo = fileMeta?.isVideo ?? isVideoFilename(filename);
  const isPdf = fileMeta?.isPdf ?? isPdfFilename(filename);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white w-full max-w-[min(1200px,95vw)] h-[min(90vh,900px)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b flex items-center justify-between">
          <div className="font-medium text-sm sm:text-base truncate" title={filename}>
            {filename || "Aperçu du document"}
          </div>
          <div className="flex items-center gap-2">
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs sm:text-sm px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 border"
              >
                Ouvrir dans un nouvel onglet
              </a>
            )}
            <button
              onClick={onClose}
              className="text-xs sm:text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="flex-1 bg-gray-50">
          {/* Vidéo */}
          {isVideo && streamUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <video
                controls
                className="max-w-full max-h-full"
                src={streamUrl}
              />
            </div>
          ) : null}

          {/* PDF natif via <iframe> */}
          {!isVideo && isPdf && url ? (
            <iframe
              title="pdf-viewer"
              src={url}
              className="w-full h-full"
            />
          ) : null}

          {/* Fallback générique */}
          {!isVideo && !isPdf ? (
            <div className="p-6 text-sm text-gray-600 h-full overflow-auto">
              <p className="mb-2">
                Prévisualisation intégrée indisponible pour ce type de fichier.
              </p>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Télécharger / Ouvrir le fichier
                </a>
              ) : (
                <p className="text-red-600">
                  URL de fichier manquante. Configure l’endpoint <code>/api/ask-veeva/file/:docId</code>.
                </p>
              )}
              <div className="mt-4 text-xs text-gray-500 break-all">
                <div><span className="font-medium">doc_id:</span> {doc_id || "—"}</div>
                <div><span className="font-medium">filename:</span> {filename || "—"}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Sidebar documents (focus)
   =========================== */
function SidebarContexts({ contexts, activeDocId, onFocusDoc, onAskDoc, onPreview }) {
  if (!contexts?.length)
    return <div className="text-sm text-gray-500">Aucun document dans le contexte.</div>;

  return (
    <div className="space-y-3">
      {contexts.map((d) => {
        const active = d.doc_id === activeDocId;
        const filename = d.filename || "";
        const hasVideo = isVideoFilename(filename);
        const isPdf = isPdfFilename(filename);

        return (
          <div
            key={d.doc_id}
            className={cx(
              "border rounded-xl p-3 transition-colors",
              active ? "border-indigo-400 bg-indigo-50" : "bg-white"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate" title={filename}>
                {filename}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onPreview?.({ doc_id: d.doc_id, filename, isVideo: hasVideo, isPdf })}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 border"
                >
                  Prévisualiser
                </button>
                <button
                  onClick={() => onFocusDoc(d.doc_id)}
                  className={cx(
                    "text-xs px-2 py-1 rounded",
                    active ? "bg-indigo-600 text-white" : "bg-gray-100 hover:bg-gray-200"
                  )}
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

            <div className="mt-2 text-[11px] text-gray-500">
              {hasVideo && <span className="mr-2 inline-block px-2 py-0.5 bg-black text-white rounded">VIDÉO</span>}
              {isPdf && <span className="inline-block px-2 py-0.5 bg-gray-200 rounded">PDF</span>}
            </div>

            <div className="mt-2 text-xs text-gray-700">
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

/* ===========================
   Chat + Sidebar + Viewer
   =========================== */
function ChatBox() {
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [k, setK] = useState(6);
  const [contexts, setContexts] = useState([]);          // données pour la sidebar
  const [activeDocId, setActiveDocId] = useState(null);  // doc focalisé
  const listRef = useRef(null);

  // Viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerMeta, setViewerMeta] = useState(null);

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
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // auto-scroll messages
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function runAsk(q, docFilter = []) {
    setSending(true);
    try {
      const resp = await ask(q, k, docFilter);
      const text = resp?.text || "Désolé, aucune réponse.";
      const citations = (resp?.citations || []).map((c) => ({
        filename: c.filename,
        score: c.score,
        doc_id: c.doc_id,          // on garde doc_id si présent
        chunk_index: c.chunk_index // utile pour navigation future
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
    setTimeout(onSend, 20);
  }

  function onClearChat() {
    try { sessionStorage.removeItem("askVeeva_chat"); } catch {}
    setMessages([{ role: "assistant", text: "Conversation réinitialisée. Posez votre question." }]);
    setContexts([]);
    setActiveDocId(null);
  }

  function openViewerFromDoc({ doc_id, filename, isVideo, isPdf }) {
    setViewerMeta({
      doc_id,
      filename,
      isVideo,
      isPdf,
      url: buildFileUrl(doc_id),
      streamUrl: buildStreamUrl(doc_id),
    });
    setViewerOpen(true);
  }

  function openViewerFromCitation(c) {
    // On tente de retrouver un context qui matche le filename ou doc_id
    const match =
      contexts.find((d) => d.doc_id === c.doc_id) ||
      contexts.find((d) => d.filename === c.filename) ||
      null;

    openViewerFromDoc({
      doc_id: match?.doc_id || c.doc_id,
      filename: match?.filename || c.filename,
      isVideo: isVideoFilename(match?.filename || c.filename),
      isPdf: isPdfFilename(match?.filename || c.filename),
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header flexible (paddings compacts sur mobile) */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-600 flex items-center gap-2">
          <span>{ready ? "Connecté" : "Hors-ligne"} •</span>
          <span>Top-K</span>
          <select
            className="border rounded px-1 py-0.5 text-sm"
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          >
            {[3, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
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

      {/* Grille responsive full-height :
         - mobile : 1 colonne (chat)
         - md : 2 colonnes (chat + sidebar)
         - xl : 3 colonnes (chat 2/3, sidebar 1/3)
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Chat (prend 2 colonnes en xl) */}
        <div className="xl:col-span-2">
          <div
            ref={listRef}
            className="h-[60vh] sm:h-[65vh] lg:h-[70vh] 2xl:h-[74vh] overflow-auto space-y-3 p-2 bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg border"
          >
            {messages.map((m, i) => (
              <Message
                key={i}
                role={m.role}
                text={m.text}
                citations={m.citations}
                onOpenCitation={openViewerFromCitation}
              />
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

        {/* Sidebar */}
        <aside className="xl:col-span-1">
          <div className="border rounded-lg p-3 bg-white h-[60vh] sm:h-[65vh] lg:h-[70vh] 2xl:h-[74vh] overflow-auto">
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
              onPreview={openViewerFromDoc}
            />
          </div>
        </aside>
      </div>

      {/* Viewer modal */}
      <ViewerPanel
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        fileMeta={viewerMeta}
      />
    </div>
  );
}

/* ===========================
   Import Box (inchangé + responsive)
   =========================== */
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

/* ===========================
   Page
   =========================== */
export default function AskVeevaPage() {
  const [tab, setTab] = useState("chat"); // 'chat' | 'import'

  return (
    <section className="max-w-[min(1600px,100vw-16px)] mx-auto px-3 sm:px-4">
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
