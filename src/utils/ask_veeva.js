// src/utils/ask_veeva.js
import { get, post } from "../lib/api.js";

/* ------------------------------------------------------------------ *
 * Small fetch helpers
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UI_VERSION = "fe-2025-10-12.2"; // bump pour DeepSearch + lang hints

async function withTimeoutFetch(input, init = {}, ms = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const nextInit = { ...init, signal: ctrl.signal, credentials: "include" };
    return await fetch(input, nextInit);
  } finally {
    clearTimeout(id);
  }
}

async function tryJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return await res.json(); } catch {}
  }
  return null;
}

async function fetchPathForm(path, formData, timeoutMs = 30000) {
  const res = await withTimeoutFetch(
    path,
    {
      method: "POST",
      body: formData,
      credentials: "include",
    },
    timeoutMs
  );

  if (!res.ok) {
    const maybeJson = await tryJson(res);
    if (maybeJson?.error) throw new Error(maybeJson.error);
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await tryJson(res)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Intent & normalization helpers (client-side hints)
 * ------------------------------------------------------------------ */

/** Détecte si une chaîne ressemble à un email (léger) */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(s || "").trim());

/** Détection FR/EN extrêmement légère (sert de hint ; le backend reconfirme) */
function detectLanguage(q = "") {
  const s = ` ${String(q || "").toLowerCase()} `;
  const hasAcc = /[éèàùâêîôûç]/i.test(q);
  const frHits = [" le ", " la ", " les ", " des ", " du ", " de ", " procédure", " procédures", " déchets", " variateur"].reduce((a, w) => a + (s.includes(w) ? 1 : 0), 0);
  const enHits = [" the ", " and ", " or ", " procedure", " procedures", " checklist", " waste", " drive", " vfd"].reduce((a, w) => a + (s.includes(w) ? 1 : 0), 0);
  if (hasAcc || frHits - enHits >= 2) return "fr";
  if (enHits - frHits >= 2) return "en";
  return "fr";
}

/** Normalise quelques patterns fréquents (SOP & N2000-2 variantes) */
export function normalizeQuery(q = "") {
  let s = String(q || "");
  // N2000-2 / 20002 / 2000 2 → N2000-2
  s = s.replace(/\bN?\s*([12]\d{3})\s*[- ]?\s*([12])\b/gi, (_m, a, b) => `N${a}-${b}`);
  // variantes N20002 → N2000-2
  s = s.replace(/\bN?(\d{4})0?[- ]?([12])\b/gi, (_m, a, b) => `N${a}-${b}`);
  // SOP → QD-SOP-XXXXXX (si 5-7 digits)
  s = s.replace(/\b(QD-?\s*)?SOP[-\s]?(\d{5,7})\b/gi, (_m, _q, num) => `QD-SOP-${String(num).padStart(6, "0")}`);
  return s;
}

const RE_DESCRIBE = /\b(d[ée]cris|r[ée]sume|[ée]léments? principaux|contenu|points? cl[ée]s|proc[ée]dure|[ée]tapes|qu'est-ce|quels sont|what is|describe)\b/i;
const RE_ANALYZE  = /\b(incoh[ée]rences?|contradictions?|divergences?|compare(r|z|)|coh[ée]rence|conflits?|gap analysis|differences?)\b/i;
const RE_SOP      = /\b(QD-?\s*)?SOP\b/i;

export function guessIntent(q = "") {
  const s = String(q || "");
  if (RE_ANALYZE.test(s)) return "analyze";
  if (RE_DESCRIBE.test(s)) return "describe";
  if (RE_SOP.test(s)) return "sop_lookup";
  return "rag";
}

/* ------------------------------------------------------------------ *
 * Public API wrappers
 * ------------------------------------------------------------------ */

/** Healthcheck */
export async function health() {
  return get("/api/ask-veeva/health");
}

/** Profil courant (auto via SSO / cookie) */
export async function getCurrentUser() {
  return get("/api/ask-veeva/me");
}
/** Alias rétro-compatible */
export const me = getCurrentUser;

/* ------------------------------ ASK / SEARCH ------------------------------ */

/**
 * ASK (RAG+intents) — avec personnalisation et DeepSearch hints.
 *
 * Signatures compatibles:
 *   - historique: ask(q, k, docFilter, email, "auto")
 *   - actuelle:   ask(q, k, docFilter, "auto", email)
 *   - étendue:    ask(q, k, docFilter, "auto", email, { forceDeep, rerank, mmr, language })
 *   - étendue bis:ask(q, k, docFilter, "auto", { forceDeep, ... })  // email omis
 *
 * Les champs "extra" sont des HINTS: le backend fonctionne même s'ils sont ignorés.
 */
export async function ask(
  question,
  k = 6,
  docFilter = [],
  contextMode = "auto",
  email = null,
  extra = {}
) {
  // Compat: si contextMode est un email
  if (looksLikeEmail(contextMode) && (email === null || email === undefined)) {
    email = contextMode;
    contextMode = "auto";
  }
  // Compat: si "email" est en fait l'objet options
  if (email && typeof email === "object" && extra && Object.keys(extra).length === 0) {
    extra = email;
    email = null;
  }
  if (contextMode == null || contextMode === "") contextMode = "auto";

  const normalized = normalizeQuery(question);
  const lang = extra.language || detectLanguage(question);

  const body = {
    question,
    k,
    docFilter,
    contextMode,
    // hints côté client (le backend les ignore si non gérés)
    ui_version: UI_VERSION,
    intent_hint: guessIntent(question),
    preferred_language: lang,        // NEW: pont FR↔EN côté serveur
    normalized_query: normalized !== question ? normalized : undefined,
    // DeepSearch hints (non bloquants)
    force_deep: extra.forceDeep ?? true,
    rerank: extra.rerank ?? true,
    mmr: extra.mmr ?? true
  };
  if (email && looksLikeEmail(email)) body.email = email;

  // Nettoyage des champs undefined pour garder un payload propre
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  return post("/api/ask-veeva/ask", body);
}

/** Aides explicites (wrappers) — force wording côté user, garde Deep hints */
export async function askDescribe(target, opts = {}) {
  const q = typeof target === "string"
    ? `Décris-moi précisément les éléments principaux, étapes, IPC et tolérances de: ${target}`
    : `Décris-moi précisément le document demandé.`;
  return ask(q, opts.k ?? 6, opts.docFilter ?? [], opts.contextMode ?? "auto", opts.email ?? null, {
    forceDeep: opts.forceDeep ?? true,
    rerank: opts.rerank ?? true,
    mmr: opts.mmr ?? true,
    language: opts.language
  });
}

export async function askAnalyze(topic, opts = {}) {
  const q = `Compare et détecte les incohérences/contradictions sur: ${topic}. Donne recommandations actionnables.`;
  return ask(q, opts.k ?? 6, opts.docFilter ?? [], opts.contextMode ?? "auto", opts.email ?? null, {
    forceDeep: opts.forceDeep ?? true,
    rerank: opts.rerank ?? true,
    mmr: opts.mmr ?? true,
    language: opts.language
  });
}

/** Recherche simple (autocomplete / fallback). DeepSearch est côté /ask. */
export async function search(query, k = 10, email = null) {
  const body = { query: normalizeQuery(query), k };
  if (email && looksLikeEmail(email)) body.email = email;
  return post("/api/ask-veeva/search", body);
}

/** “Vouliez-vous dire…” – filename/fuzzy léger (backend find-docs) */
export async function findDocs(q) {
  const qs = new URLSearchParams({ q: normalizeQuery(q) ?? "" }).toString();
  return get(`/api/ask-veeva/find-docs?${qs}`);
}

/* ------------------------------ Uploads ------------------------------ */

/** Upload direct (ZIP ≤ 300MB ou fichier simple) */
export async function uploadSmall(file) {
  const fd = new FormData();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "zip") {
    fd.append("zip", file);
    return fetchPathForm("/api/ask-veeva/uploadZip", fd);
  }
  fd.append("file", file);
  return fetchPathForm("/api/ask-veeva/uploadFile", fd);
}

/** Chunked upload (ZIP > 300MB) */
export async function chunkedUpload(file, opts = {}) {
  const { onProgress = () => {}, partTimeoutMs = 60000, maxRetries = 3 } = opts;

  const initRes = await post("/api/ask-veeva/chunked/init", {
    filename: file.name,
    size: file.size,
  });
  if (!initRes?.uploadId || !initRes?.partSize) throw new Error("Init chunked échoué");
  const { uploadId, partSize } = initRes;

  const totalParts = Math.ceil(file.size / partSize);
  let uploadedBytes = 0;
  onProgress({ uploadedBytes, totalBytes: file.size });

  try {
    for (let part = 1; part <= totalParts; part++) {
      const start = (part - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      const fd = new FormData();
      fd.append("chunk", blob, `${file.name}.part${part}`);
      const qs = new URLSearchParams({ uploadId, partNumber: String(part) });

      let lastErr = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await fetchPathForm(`/api/ask-veeva/chunked/part?${qs.toString()}`, fd, partTimeoutMs);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await sleep(400 * (attempt + 1));
        }
      }
      if (lastErr) throw lastErr;

      uploadedBytes += blob.size;
      onProgress({ uploadedBytes, totalBytes: file.size });
    }

    const complete = await post("/api/ask-veeva/chunked/complete", {
      uploadId,
      totalParts,
      originalName: file.name,
    });
    return complete;
  } catch (e) {
    try { await post("/api/ask-veeva/chunked/abort", { uploadId, upto: totalParts }); } catch {}
    throw e;
  }
}

/** Poll job until done/error */
export function pollJob(jobId, { onTick = () => {}, minMs = 1200, maxMs = 10000 } = {}) {
  let stopped = false;
  async function loop() {
    let waitMs = minMs;
    while (!stopped) {
      try {
        const j = await get(`/api/ask-veeva/jobs/${jobId}`);
        onTick(j);
        if (j.status === "done" || j.status === "error") return j;
        await sleep(waitMs);
        waitMs = Math.min(Math.round(waitMs * 1.5), maxMs);
      } catch {
        await sleep(Math.min(waitMs * 2, maxMs));
      }
    }
  }
  return {
    stop: () => { stopped = true; },
    promise: loop(),
  };
}

/* ------------------------------ Feedback / Profil / Perso ------------------------------ */

/** Initialise ou met à jour le profil utilisateur */
export async function initUser({ email, name, role, sector }) {
  return post("/api/ask-veeva/initUser", { email, name, role, sector });
}

/** Journalisation d'événement (générique) */
export async function logEvent(event) {
  return post("/api/ask-veeva/logEvent", event);
}

/** Envoie un feedback sur une réponse IA (email facultatif) */
export async function sendFeedback({ question, doc_id, useful, note, email = null }) {
  const body = { question, doc_id, useful, note };
  if (email && looksLikeEmail(email)) body.user_email = email;
  return post("/api/ask-veeva/feedback", body);
}

/** Récupère la personnalisation (profil + docs favoris, etc.) — email facultatif */
export async function getPersonalization(email = null) {
  const body = {};
  if (email && looksLikeEmail(email)) body.email = email;
  return post("/api/ask-veeva/personalize", body);
}

/** Ajoute ou met à jour un synonyme (admin/auto) */
export async function addSynonym(term, alt_term, weight = 1.0) {
  return post("/api/ask-veeva/synonyms/update", { term, alt_term, weight });
}

/* ------------------------------ Viewer helpers ------------------------------ */

/** URL brute (original) — utile si tu connais déjà l’ID et veux tenter l’original directement */
export function buildFileURL(docId) {
  return `/api/ask-veeva/file/${docId}`;
}

/** Optionnel : flux vidéo si plus tard disponible */
export function buildStreamURL(docId) {
  return `/api/ask-veeva/stream/${docId}`;
}

/**
 * Vérifie la meilleure URL exploitable pour un doc (original ou preview).
 * Retourne { ok, url?, mime?, existsOriginal?, canPreview?, error? }.
 */
export async function checkFile(docId, timeoutMs = 8000) {
  try {
    const res = await withTimeoutFetch(
      `/api/ask-veeva/filemeta/${encodeURIComponent(docId)}`,
      { method: "GET" },
      timeoutMs
    );
    const j = await tryJson(res);
    if (!res.ok || !j) {
      return { ok: false, error: j?.error || `HTTP ${res.status}` };
    }
    if (j.ok) {
      return {
        ok: true,
        url: j.url || buildFileURL(docId),
        mime: j.mime || null,
        existsOriginal: !!j.existsOriginal,
        canPreview: !!j.canPreview,
      };
    }
    return { ok: false, error: j.error || "inconnu" };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Trace l’ouverture d’un document côté serveur (pour le boost perso).
 * Non bloquant pour l’UX.
 */
export async function openDoc(docId, extra = {}) {
  try {
    await logEvent({ type: "doc_opened", doc_id: docId, meta: extra || {} });
  } catch {
    // best-effort
  }
}

/* ------------------------------ Email helpers (client) ------------------------------ */

/** Mémorise l'email côté client (localStorage + cookie lu par le backend) */
export function setUserEmail(email) {
  try { localStorage.setItem("askVeeva_email", email); } catch {}
  try {
    const days = 365;
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `veeva_email=${encodeURIComponent(email)}; Expires=${expires}; Path=/; SameSite=Lax`;
  } catch {}
}
export function getUserEmail() {
  try { return localStorage.getItem("askVeeva_email") || null; } catch { return null; }
}

/* ------------------------------ UI helpers (facultatif) ------------------------------ */

/** Envoie un vote “👍/👎” minimaliste (utile pour les boutons pouce) */
export async function voteUseful({ question, doc_id = null, useful = true, note = "" }) {
  return sendFeedback({ question, doc_id, useful, note });
}
