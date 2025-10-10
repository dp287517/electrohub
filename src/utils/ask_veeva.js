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
    const nextInit = { ...init, signal: ctrl.signal };
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

/**
 * ASK (RAG) — avec personnalisation.
 * @param {string} question
 * @param {number} k - nombre de chunks
 * @param {string[]} docFilter - filtrer par docs
 * @param {string} email - utilisateur courant
 * @param {string} contextMode - "auto" (par défaut) ou "none"
 */
export async function ask(question, k = 6, docFilter = [], email = null, contextMode = "auto") {
  return post("/api/ask-veeva/ask", { question, k, docFilter, email, contextMode });
}

/**
 * Simple vector search (compatibilité)
 */
export async function search(query, k = 10, email = null) {
  return post("/api/ask-veeva/search", { query, k, email });
}

/**
 * (Optionnel) Fuzzy doc finder — “Vouliez-vous dire…”
 */
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

/**
 * Chunked upload (ZIP > 300MB)
 */
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
    try {
      await post("/api/ask-veeva/chunked/abort", { uploadId, upto: totalParts });
    } catch {}
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

/** Envoie un feedback sur une réponse IA */
export async function sendFeedback({ email, question, doc_id, useful, note }) {
  return post("/api/ask-veeva/feedback", { user_email: email, question, doc_id, useful, note });
}

/** Récupère la personnalisation (profil + docs favoris, etc.) */
export async function getPersonalization(email) {
  return post("/api/ask-veeva/personalize", { email });
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
