// src/pages/ask_veeva.js
import { useEffect, useMemo, useRef, useState } from "react";
import {
  health,
  me,
  ask,
  // search, // si besoin
  uploadSmall,
  chunkedUpload,
  pollJob,
  buildFileURL,
  findDocs,
  initUser,
  setUserEmail,
  getUserEmail,
  openDoc,
  checkFile,
  sendFeedback,
} from "../utils/ask_veeva.js";

/* ------------------------- Petits utilitaires UI ------------------------- */
function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
}
const copy = async (s) => {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
};
const isVideoFilename = (name = "") => /\.(mp4|mov|m4v|webm)$/i.test(name);

/* NLU ultra légère pour poste/secteur (alignée au backend) */
const ROLE_CANON = [
  ["qualité","qualite","quality"],
  ["ehs","hse","sse"],
  ["utilités","utilites","utilities","utility","utilite"],
  ["packaging","conditionnement","pack"]
];
const SECTOR_CANON = [
  ["ssol","solide","solids"],
  ["liq","liquide","liquids","liquid"],
  ["bulk","vrac"],
  ["autre","other","generic"]
];
function detectFromList(text, lists) {
  const s = (text || "").toLowerCase();
  for (const group of lists) {
    if (group.some(alias => s.includes(alias))) return group[0];
  }
  for (const group of lists) {
    if (group.some(alias => s.trim() === alias)) return group[0];
  }
  return null;
}
const detectRole = (t)=> detectFromList(t, ROLE_CANON);
const detectSector = (t)=> detectFromList(t, SECTOR_CANON);
const detectEmailInline = (t) => {
  const m = String(t||"").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
};

/* --------------------------------- UI bits -------------------------------- */
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-4 py-2 rounded-t-lg text-sm font-medium transition",
        active ? "bg-white border-x border-t border-gray-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function Chip({ children, title, onClick, kind = "indigo" }) {
  const map = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
    gray: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100",
    amber: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx("inline-flex items-center px-2 py-1 text-xs rounded-full border transition", map[kind] || map.gray)}
    >
      {children}
    </button>
  );
}

function CitationChips({ citations, onPeek, max = 3 }) {
  const [expanded, setExpanded] = useState(false);
  if (!citations?.length) return null;

  const shown = expanded ? citations : citations.slice(0, max);
  const remaining = Math.max(0, citations.length - shown.length);

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {shown.map((c, i) => (
        <Chip
          key={i}
          title={`${c.filename} • score: ${c.score?.toFixed?.(3)}`}
          onClick={() => onPeek?.(c)}
          kind="indigo"
        >
          📄 {c.filename}
        </Chip>
      ))}
      {remaining > 0 && (
        <Chip onClick={() => setExpanded(true)} kind="gray" title="Afficher toutes les citations">
          +{remaining} de plus
        </Chip>
      )}
    </div>
  );
}

function FeedbackBar({ onVote, state }) {
  // state: 'idle' | 'up' | 'down' | 'sent'
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        onClick={() => onVote("up")}
        disabled={state === "sent"}
        className={clsx(
          "text-xs px-2 py-1 rounded border transition-colors",
          state === "up" ? "bg-green-50 text-green-700 border-green-200"
                         : "bg-gray-50 text-gray-800 hover:bg-gray-100"
        )}
        title="Utile"
      >
        👍 Utile
      </button>
      <button
        onClick={() => onVote("down")}
        disabled={state === "sent"}
        className={clsx(
          "text-xs px-2 py-1 rounded border transition-colors",
          state === "down" ? "bg-red-50 text-red-700 border-red-200"
                           : "bg-gray-50 text-gray-800 hover:bg-gray-100"
        )}
        title="Pas utile"
      >
        👎 Pas utile
      </button>
      {state === "sent" && <span className="text-xs text-gray-500">Merci pour le feedback.</span>}
    </div>
  );
}

/* ----------------------- DECISION GAUGES & FLOW VIZ ----------------------- */
function Bar({ label, value = 0, hint, accent = "indigo", crowned = false, icon = "⚙️" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const barCls = {
    indigo: "bg-indigo-500",
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  }[accent] || "bg-indigo-500";

  return (
    <div className="w-full">
      <div className="flex justify-between items-end text-[11px] text-gray-700">
        <span className="font-medium flex items-center gap-1">
          <span className="text-base leading-none">{icon}</span>
          {label}
          {crowned && <span title="A pris le dessus" className="ml-1">👑</span>}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 mt-1 rounded bg-gray-200 overflow-hidden">
        <div
          className={clsx("h-2 transition-all duration-700 ease-out", barCls)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

/** Extrait des poids à partir de decision_trace renvoyé par le backend */
function extractDecisionWeights(trace) {
  const def = { ether: 40, naoris: 30, bunk: 20, maket: 10, answer: 80 };
  if (!trace || typeof trace !== "object") return def;

  const ether = Math.round((trace.hybrid_weight ?? 0.6) * 100);       // PySearch → Ether
  const naoris = Math.round((trace.vector_weight ?? 0.7) * 100);      // PgVector → Naoris
  const bunk = Math.round((trace.rerank_weight ?? 0.8) * 100);        // ReRank  → Bunk
  const maket = Math.round((trace.mmr_lambda ?? 0.7) * 100);          // MMR     → Maket
  const answer = Math.round((trace.answer_confidence ?? 0.85) * 100); // Answer

  return {
    ether: clamp01(ether),
    naoris: clamp01(naoris),
    bunk: clamp01(bunk),
    maket: clamp01(maket),
    answer: clamp01(answer),
  };
}
function clamp01(v) { return Math.max(0, Math.min(100, v)); }

/** Flow animé piloté par JS — fiable & synchrone avec l'état */
function FlowRail({ playing = true, stepDuration = 650 }) {
  const steps = [
    { key: "q", label: "Question", short: "?", icon: "❓" },
    { key: "ether", label: "Ether", short: "Eth", icon: "⚡" },
    { key: "naoris", label: "Naoris", short: "Nao", icon: "🧠" },
    { key: "bunk", label: "Bunk", short: "Bnk", icon: "🧮" },
    { key: "maket", label: "Maket", short: "Mkt", icon: "🎛️" },
    { key: "answer", label: "OpenAI Answer", short: "Ans", icon: "🤖" },
  ];
  const [idx, setIdx] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!playing) {
      setIdx(0);
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    // boucle
    timer.current = setInterval(() => {
      setIdx((i) => (i + 1) % steps.length);
    }, stepDuration);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, stepDuration]);

  const leftPct = (idx / (steps.length - 1)) * 100;

  return (
    <div className="w-full">
      {/* bande labels — compacte & scrollable sur mobile */}
      <div className="flex overflow-x-auto no-scrollbar gap-2 sm:gap-3 px-1 sm:px-2">
        {steps.map((s, i) => (
          <div key={s.key} className="shrink-0 text-[11px] sm:text-[12px]">
            <div className={clsx(
              "px-2 py-1 rounded border bg-white shadow-sm flex items-center gap-1 whitespace-nowrap",
              i === idx ? "border-blue-300 ring-1 ring-blue-200" : "border-gray-200"
            )}>
              <span className="text-sm">{s.icon}</span>
              {/* Sur mobile, n'afficher que l’abrégé; sur sm+ le nom complet */}
              <span className="sm:hidden">{s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* rail */}
      <div className="relative mx-2 sm:mx-3 mt-3 h-2 rounded bg-gradient-to-r from-indigo-200 via-sky-200 to-violet-200 overflow-hidden">
        <div className="absolute inset-0 opacity-50">
          <div className="w-full h-full bg-[linear-gradient(90deg,rgba(255,255,255,.25)_0,rgba(255,255,255,0)_20%,rgba(255,255,255,0)_80%,rgba(255,255,255,.25)_100%)] animate-[ping_3s_infinite]" />
        </div>
        {/* dot animée : pilotée par left% + transition */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-blue-600 shadow-md transition-all duration-500"
          style={{ left: `calc(${leftPct}% - 6px)` }}
        />
      </div>
    </div>
  );
}

function DecisionGauges({ decisionTrace }) {
  const w = extractDecisionWeights(decisionTrace);
  const base = [
    { k: "ether", v: w.ether },
    { k: "naoris", v: w.naoris },
    { k: "bunk", v: w.bunk },
    { k: "maket", v: w.maket },
  ];
  const top = base.reduce((a, b) => (b.v > a.v ? b : a), base[0])?.k;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Bar label="⚡ Ether" value={w.ether} hint="BM25/TF-IDF + heuristiques" accent="indigo" crowned={top==="ether"} icon="⚡" />
      <Bar label="🧠 Naoris" value={w.naoris} hint="Matching vecteur" accent="sky" crowned={top==="naoris"} icon="🧠" />
      <Bar label="🧮 Bunk" value={w.bunk} hint="Rerank cross-encoder" accent="emerald" crowned={top==="bunk"} icon="🧮" />
      <Bar label="🎛️ Maket" value={w.maket} hint="Diversification MMR (λ)" accent="amber" crowned={top==="maket"} icon="🎛️" />
      <div className="sm:col-span-2">
        <Bar label="🤖 OpenAI Answer" value={w.answer} hint="Synthèse contrôlée par contexte" accent="rose" icon="🤖" />
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

      <div className="space-y-2 overflow-auto pr-1">
        {!contexts?.length && (
          <div className="text-sm text-gray-500">Aucun document dans le contexte.</div>
        )}
        {contexts?.map((d) => {
          const checked = selected.has(d.doc_id);
          return (
            <div key={d.doc_id} className="border rounded-lg p-2 bg-white flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-blue-600"
                checked={checked}
                onChange={() => toggleSelect(d.doc_id)}
                title="Ajouter/retirer du focus multiple"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[13px] break-words whitespace-break-spaces leading-snug">
                  📄 {d.filename}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------- Viewer pane ------------------------------- */
function Viewer({ file, onClose }) {
  const [err, setErr] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [mime, setMime] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!file) return;
      setErr(null);
      const res = await checkFile(file.doc_id);
      if (cancel) return;
      if (res.ok) {
        setPreviewUrl(res.url || buildFileURL(file.doc_id));
        setMime(res.mime || null);
      } else {
        setErr(res.error || "indisponible");
        setPreviewUrl(buildFileURL(file.doc_id));
      }
    })();
    return () => { cancel = true; };
  }, [file]);

  if (!file) return null;

  const url = previewUrl || buildFileURL(file.doc_id);
  const looksVideo = isVideoFilename(file.filename);
  const looksPdf = (mime && mime.includes("pdf")) || /\.pdf$/i.test(file.filename);

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="min-w-0 pr-2">
            <div className="text-sm text-gray-500">Prévisualisation</div>
            <div className="font-medium text-[13px] break-words whitespace-break-spaces">{file.filename}</div>
            {err && (
              <div className="mt-1 text-xs text-red-700">
                Impossible d’afficher le document ({err}). Utilisez “Ouvrir l’original”.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
              title="Ouvrir dans un nouvel onglet"
              onClick={() => openDoc(file.doc_id, { from: "viewer_open_original" })}
            >
              Ouvrir l’original
            </a>
            <button
              onClick={() => copy(url)}
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
              <video
                src={url}
                controls
                className="w-full h-[70vh] max-h-full"
                onError={() => setErr("erreur de lecture vidéo")}
              />
            </div>
          ) : looksPdf ? (
            <object
              data={`${url}#view=FitH`}
              type="application/pdf"
              className="w-full h-[80vh]"
              onError={() => setErr("erreur de rendu PDF")}
            >
              <iframe
                title="preview-pdf-fallback"
                src={url}
                className="w-full h-[80vh]"
                loading="eager"
                onError={() => setErr("erreur de chargement iframe")}
              />
            </object>
          ) : (
            <iframe
              title="preview"
              src={url}
              className="w-full h-[80vh]"
              loading="eager"
              onError={() => setErr("erreur de chargement iframe")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Flow Modal ------------------------------ */
function FlowModal({ open, onClose, lastDecision }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-semibold">Comment ça marche (visu)</div>
          <div className="flex items-center gap-2">
            <a
              href="/ask-veeva-viz.html"
              target="_blank"
              rel="noreferrer"
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
              title="Ouvrir la page de présentation (plein écran)"
            >
              Ouvrir en plein écran
            </a>
            <button onClick={onClose} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">Fermer</button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <FlowRail playing />
          <DecisionGauges decisionTrace={lastDecision} />
          <div className="grid sm:grid-cols-2 gap-3 text-[13px] text-gray-700">
            <div className="p-3 rounded-lg bg-gray-50 border">
              <div className="font-medium mb-1">🧮 Bunk (ReRank)</div>
              <div className="text-xs text-gray-500 mt-1">
                Re-score des candidats (Ether + Naoris) par similarité sémantique.
              </div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border">
              <div className="font-medium mb-1">🤖 Réponse OpenAI</div>
              <div className="text-xs text-gray-500 mt-1">
                Synthèse stricte basée sur le contexte (citations incluses).
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Astuce : Les jauges reflètent les poids utilisés dans la décision pour <em>cette</em> réponse.
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Chat Box -------------------------------- */
function Message({ role, text, citations, onPeek, feedback, onVote, msgRef }) {
  const isUser = role === "user";
  return (
    <div ref={msgRef} className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[95%] sm:max-w-[75%] md:max-w-[65%] rounded-2xl px-4 py-3 shadow",
          isUser ? "bg-blue-600 text-white rounded-br-sm" : "bg-white text-gray-900 rounded-bl-sm border"
        )}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
        {!isUser && <CitationChips citations={citations} onPeek={onPeek} />}
        {!isUser && onVote && (
          <FeedbackBar onVote={onVote} state={feedback?.state || "idle"} />
        )}
      </div>
    </div>
  );
}

function ChatBox() {
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [contexts, setContexts] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState(() => new Set());
  const [suggestions, setSuggestions] = useState([]);
  const [viewerFile, setViewerFile] = useState(null);

  // decision trace & flow modal
  const [lastDecision, setLastDecision] = useState(null);
  const [showViz, setShowViz] = useState(false);

  // Profil courant
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState(getUserEmail());
  const [waitingProfile, setWaitingProfile] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState(null);

  // messages + refs (pour scroller sur le haut d'une réponse)
  const listRef = useRef(null);
  const msgRefs = useRef([]);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = sessionStorage.getItem("askVeeva_chat");
      return raw ? JSON.parse(raw) : [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    } catch {
      return [{ role: "assistant", text: "Bonjour 👋 — Posez votre question." }];
    }
  });

  // Feedback local
  const [feedbackState, setFeedbackState] = useState({});

  useEffect(() => {
    sessionStorage.setItem("askVeeva_chat", JSON.stringify(messages));
  }, [messages]);

  // Boot
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = await health();
        if (alive) setReady(!!h?.ok);
      } catch {
        setReady(false);
      }
      try {
        const r = await me();
        if (alive && r?.ok) {
          setUser(r.user || null);
          if (r?.user?.email) {
            setEmail(r.user.email);
            setUserEmail(r.user.email);
          }
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // scroll helper : uniquement sur envoi user, on va en bas
  function scrollToBottom() {
    if (!listRef.current) return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }
  // scroll sur le haut de la dernière réponse assistant
  function scrollToAssistantTop(index) {
    const el = msgRefs.current[index];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function toggleSelect(docId) {
    setSelectedDocs((prev) => {
      const n = new Set(prev);
      if (n.has(docId)) n.delete(docId);
      else n.add(docId);
      return n;
    });
  }
  function selectOnly(docId) { setSelectedDocs(new Set([docId])); }
  function clearSelection() { setSelectedDocs(new Set()); }

  function setMsgFeedback(idx, next) {
    setFeedbackState((s) => ({ ...s, [idx]: next }));
  }

  async function submitFeedbackFor(index, vote) {
    const assistantMsg = messages[index];
    const lastUserBefore = [...messages.slice(0, index)].reverse().find((m) => m.role === "user")?.text || "";
    const primaryCitation = assistantMsg?.citations?.[0]?.doc_id || null;

    try {
      setMsgFeedback(index, vote);
      await sendFeedback({
        question: lastUserBefore || "(question inconnue - feedback inline)",
        doc_id: primaryCitation,
        useful: vote === "up",
        note: null,
        email: email || null,
      });
      setMsgFeedback(index, "sent");
    } catch {
      // best-effort
    }
  }

  // cœur: ask + needProfile
  async function runAsk(q, docFilter = []) {
    setSending(true);
    try {
      const resp = await ask(q, undefined, docFilter, "auto", email);

      if (resp?.needProfile) {
        setPendingQuestion(q);
        setWaitingProfile(true);
        setMessages((m) => [...m, { role: "assistant", text: resp.question }]);
        return;
      }

      const text = resp?.text || "Désolé, aucune réponse.";
      const citations = (resp?.citations || []).map((c) => ({
        filename: c.filename,
        score: c.score,
        doc_id: c.doc_id,
      }));

      // append assistant message + scroll sur le haut de CETTE réponse
      setMessages((m) => {
        const next = [...m, { role: "assistant", text, citations }];
        setTimeout(() => scrollToAssistantTop(next.length - 1), 50);
        return next;
      });

      setContexts(resp?.contexts || []);
      setSuggestions((resp?.suggestions || []).slice(0, 8));
      setLastDecision(resp?.decision_trace || null);
    } catch (e) {
      setMessages((m) => {
        const next = [...m, { role: "assistant", text: `Une erreur est survenue : ${e?.message || e}` }];
        setTimeout(() => scrollToAssistantTop(next.length - 1), 50);
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  // Profil via saisie
  async function tryCompleteProfileFrom(text) {
    const emailInline = detectEmailInline(text);
    let role = detectRole(text);
    let sector = detectSector(text);

    if (!emailInline && !role && !sector) return false;

    const payload = {
      email: emailInline || email || undefined,
      role: role || undefined,
      sector: sector || undefined,
    };

    if (payload.email && payload.email !== email) {
      setEmail(payload.email);
      setUserEmail(payload.email);
    }

    try {
      const ret = await initUser(payload);
      if (ret?.ok && ret?.user) {
        setUser(ret.user);
      }
      if (role || sector) {
        setWaitingProfile(false);
        const q = pendingQuestion || "Merci. Quelle est votre question ?";
        setPendingQuestion(null);
        await runAsk(q, selectedDocs.size ? Array.from(selectedDocs) : []);
        return true;
      }
    } catch (e) {
      setMessages((m) => {
        const next = [...m, { role: "assistant", text: `Impossible d'enregistrer le profil : ${e?.message || e}` }];
        setTimeout(() => scrollToAssistantTop(next.length - 1), 50);
        return next;
      });
    }
    return false;
  }

  async function onSend() {
    const q = input.trim();
    if (!q || sending) return;

    setInput("");
    setMessages((m) => {
      const next = [...m, { role: "user", text: q }];
      // sur envoi user: on descend en bas pour voir sa question envoyée
      setTimeout(() => scrollToBottom(), 30);
      return next;
    });

    if (waitingProfile) {
      const updated = await tryCompleteProfileFrom(q);
      if (updated) return;
      return;
    }

    const emailInline = detectEmailInline(q);
    if (emailInline && emailInline !== email) {
      setEmail(emailInline);
      setUserEmail(emailInline);
      try { await initUser({ email: emailInline }); } catch {}
    }

    const docFilter = selectedDocs.size ? Array.from(selectedDocs) : [];
    await runAsk(q, docFilter);
  }

  function quickAsk(s) { setInput(s); setTimeout(onSend, 10); }

  async function onAskSelected() {
    const lastQ =
      [...messages].reverse().find((m) => m.role === "user")?.text ||
      input ||
      "Peux-tu détailler ?";
    if (!selectedDocs.size) return;
    setMessages((m) => {
      const next = [...m, { role: "user", text: `${lastQ} (focus multi)` }];
      setTimeout(() => scrollToBottom(), 30);
      return next;
    });
    await runAsk(lastQ, Array.from(selectedDocs));
  }

  async function handlePeek(c) {
    setViewerFile({ doc_id: c.doc_id, filename: c.filename });
    try { await openDoc(c.doc_id, { from: "peek" }); } catch {}
  }

  async function handleOpen(c) {
    const res = await checkFile(c.doc_id);
    if (!res.ok) {
      alert(`Impossible d’ouvrir le fichier : ${res.error || "inconnu"}`);
      return;
    }
    try { await openDoc(c.doc_id, { from: "sidebar_open" }); } catch {}
    window.open(res.url || buildFileURL(c.doc_id), "_blank", "noopener");
  }

  async function tryDidYouMean(q) {
    if (!q || q.length < 3) return;
    try {
      const ret = await findDocs(q);
      if (ret?.items?.length) {
        setSuggestions(ret.items.slice(0, 8).map((it) => it.filename));
      }
    } catch { /* endpoint optionnel */ }
  }

  function onClearChat() {
    try { sessionStorage.removeItem("askVeeva_chat"); } catch {}
    setMessages([{ role: "assistant", text: "Conversation réinitialisée. Posez votre question." }]);
    setContexts([]);
    setSelectedDocs(new Set());
    setSuggestions([]);
    setWaitingProfile(false);
    setPendingQuestion(null);
    setFeedbackState({});
    setLastDecision(null);
    // Revenir en haut de la zone liste
    if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: "smooth" });
  }

  const weights = extractDecisionWeights(lastDecision);

  return (
    <div className="flex flex-col h-full">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-900 font-medium flex items-center gap-2">
          🔎 Recherche IA
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowViz(true)}
            className="text-xs px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700"
            title="Voir la visualisation du fonctionnement (modale)"
          >
            🎬 Voir la visualisation
          </button>
          <button
            onClick={onClearChat}
            className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
          >
            🗑️ Supprimer la conversation
          </button>
        </div>
      </div>

      {/* Bandeau décision (flow + gauges compactes) */}
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-3 mb-3">
        <div className="rounded-lg border bg-white p-3">
          {/* playing = !sending : s'arrête quand la réponse est finie */}
          <FlowRail playing={!sending} />
        </div>
        <div className="rounded-lg border bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            <Bar label="⚡ Ether" value={weights.ether} accent="indigo" icon="⚡" />
            <Bar label="🧠 Naoris" value={weights.naoris} accent="sky" icon="🧠" />
            <Bar label="🧮 Bunk" value={weights.bunk} accent="emerald" icon="🧮" />
            <Bar label="🎛️ Maket" value={weights.maket} accent="amber" icon="🎛️" />
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
              <Message
                key={i}
                msgRef={(el) => (msgRefs.current[i] = el)}
                role={m.role}
                text={m.text}
                citations={m.citations}
                onPeek={(c) => {
                  setViewerFile({ doc_id: c.doc_id, filename: c.filename });
                  try { openDoc(c.doc_id, { from: "chip_peek" }); } catch {}
                }}
                feedback={m.role === "assistant" ? { state: feedbackState[i] || "idle" } : null}
                onVote={
                  m.role === "assistant"
                    ? async (vote) => submitFeedbackFor(i, vote)
                    : null
                }
              />
            ))}
            {sending && <div className="text-xs text-gray-500 animate-pulse px-2">Ask Veeva rédige…</div>}
          </div>

          {/* Saisie + suggestions */}
          {!!suggestions.length && (
            <div className="mt-2 flex items-start gap-2 flex-wrap">
              <div className="text-xs text-gray-600 mt-1">Vouliez-vous dire :</div>
              {suggestions.map((s, i) => (
                <Chip
                  key={i}
                  onClick={() => quickAsk(s)}
                  kind="amber"
                  title="Lancer une recherche avec ce terme"
                >
                  💡 {s}
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end gap-2">
            <textarea
              rows={2}
              className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-black placeholder-gray-500"
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
              Envoyer 🚀
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
              onPeek={(c) => {
                setViewerFile({ doc_id: c.doc_id, filename: c.filename });
                try { openDoc(c.doc_id, { from: "sidebar_peek" }); } catch {}
              }}
              onOpen={handleOpen}
            />
          </div>
        </aside>
      </div>

      {/* Viewer modal */}
      <Viewer file={viewerFile} onClose={() => setViewerFile(null)} />

      {/* Flow modal */}
      <FlowModal open={showViz} onClose={() => setShowViz(false)} lastDecision={lastDecision} />
    </div>
  );
}

/* -------------------------------- Import box ------------------------------- */
/* ⚠️ NE PAS MODIFIER CETTE PARTIE (demandé) */
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
        <div className="text-sm text-gray-600 mt-1">
          Formats pris en charge : ZIP, PDF, DOCX, XLSX/XLS, CSV, TXT, MP4/WEBM/MOV.
        </div>
        <div className="mt-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer">
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            Choisir un fichier…
          </label>
        </div>
        {file && (
          <div className="mt-3 text-sm text-gray-800 break-all">
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
                  : "text-gray-800"
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
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold">Ask Veeva</h1>
        <a
          href="/ask-veeva-viz.html"
          target="_blank"
          rel="noreferrer"
          className="text-xs px-3 py-1.5 rounded bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
          title="Voir la page de présentation (plein écran)"
        >
          🎥 Page de présentation
        </a>
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
