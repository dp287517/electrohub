// src/utils/ask_veeva.js
import { get, post } from "../lib/api.js";

/* ------------------------------------------------------------------ *
 * Small fetch helpers
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * ASK (RAG) — avec personnalisation.
 * @param {string} question
 * @param {number} k
 * @param {string[]} docFilter
 * @param {string} contextMode - "auto" ou "none"
 * @param {string|null} email - facultatif (sinon cookie)
 */
export async function ask(question, k = 6, docFilter = [], contextMode = "auto", email = null) {
  const body = { question, k, docFilter, contextMode };
  if (email) body.email = email; // le backend lit aussi le cookie si absent
  return post("/api/ask-veeva/ask", body);
}

/** Recherche simple */
export async function search(query, k = 10, email = null) {
  const body = { query, k };
  if (email) body.email = email;
  return post("/api/ask-veeva/search", body);
}

/** (Optionnel) Fuzzy doc finder — “Vouliez-vous dire…” */
export async function findDocs(q) {
  const qs = new URLSearchParams({ q: q ?? "" }).toString();
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

/** Journalisation d'événement (doc ouvert, etc.) */
export async function logEvent(event) {
  return post("/api/ask-veeva/logEvent", event);
}

/** Envoie un feedback sur une réponse IA (email facultatif) */
export async function sendFeedback({ question, doc_id, useful, note, email = null }) {
  const body = { question, doc_id, useful, note };
  if (email) body.user_email = email;
  return post("/api/ask-veeva/feedback", body);
}

/** Récupère la personnalisation (profil + docs favoris, etc.) — email facultatif */
export async function getPersonalization(email = null) {
  const body = {};
  if (email) body.email = email;
  return post("/api/ask-veeva/personalize", body);
}

/** Ajoute ou met à jour un synonyme (admin/auto) */
export async function addSynonym(term, alt_term, weight = 1.0) {
  return post("/api/ask-veeva/synonyms/update", { term, alt_term, weight });
}

/* ------------------------------ Viewer helpers ------------------------------ */

/** URL pour ouvrir/télécharger l’original */
export function buildFileURL(docId) {
  return `/api/ask-veeva/file/${docId}`;
}

/** Optionnel : flux vidéo si plus tard disponible */
export function buildStreamURL(docId) {
  return `/api/ask-veeva/stream/${docId}`;
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
