// src/utils/ask_veeva.js
import { get, post } from "../lib/api.js";

/** ---- helpers communs ---- */
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

/** ---------------------------------------------------------------------------
 *  API: Health
 * ------------------------------------------------------------------------- */
export async function health() {
  return get("/api/ask-veeva/health");
}

/** ---------------------------------------------------------------------------
 *  API: Search (top-k chunks)
 * ------------------------------------------------------------------------- */
export async function search(query, k = 6) {
  return post("/api/ask-veeva/search", { query, k });
}

/** ---------------------------------------------------------------------------
 *  API: Ask (RAG) avec filtre optionnel sur des documents
 * ---------------------------------------------------------------------------
 * @param {string} question - La question utilisateur
 * @param {number} [k=6] - Nombre d'extraits à fournir au modèle
 * @param {string[]} [docFilter=[]] - Tableau d'UUID (documents ciblés)
 * @returns {Promise<{ok:boolean,text:string,citations:any[],contexts:any[]}>}
 */
export async function ask(question, k = 6, docFilter = []) {
  // garde-fous: unique + UUID-like simples (facultatif, mais évite du bruit)
  const list = Array.isArray(docFilter) ? [...new Set(docFilter.filter(Boolean))] : [];
  return post("/api/ask-veeva/ask", { question, k, docFilter: list });
}

/** ---------------------------------------------------------------------------
 *  API: Upload direct (petits fichiers / ZIP <= ~300 Mo côté serveur)
 * ------------------------------------------------------------------------- */
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

/** ---------------------------------------------------------------------------
 *  API: Upload fractionné (gros ZIP)
 * ---------------------------------------------------------------------------
 * @param {File} file
 * @param {{onProgress?:Function, partTimeoutMs?:number, maxRetries?:number}} opts
 */
export async function chunkedUpload(file, opts = {}) {
  const { onProgress = () => {}, partTimeoutMs = 60000, maxRetries = 3 } = opts;

  // 1) init
  const initRes = await post("/api/ask-veeva/chunked/init", {
    filename: file.name,
    size: file.size,
  });
  if (!initRes?.uploadId || !initRes?.partSize) throw new Error("Init chunked échoué");
  const { uploadId, partSize } = initRes;

  // 2) part-by-part avec retry
  const totalParts = Math.ceil(file.size / partSize);
  let uploadedBytes = 0;
  onProgress({ part: 0, totalParts, uploadedBytes, totalBytes: file.size });

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
          await sleep(400 * (attempt + 1)); // backoff simple
        }
      }
      if (lastErr) throw lastErr;

      uploadedBytes += blob.size;
      onProgress({ part, totalParts, uploadedBytes, totalBytes: file.size });
    }

    // 3) complete
    const complete = await post("/api/ask-veeva/chunked/complete", {
      uploadId,
      totalParts,
      originalName: file.name,
    });
    return complete; // { ok, job_id }
  } catch (e) {
    // Abort propre si une part échoue
    try {
      await post("/api/ask-veeva/chunked/abort", { uploadId, upto: totalParts });
    } catch {}
    throw e;
  }
}

/** ---------------------------------------------------------------------------
 *  API: Poll job (backoff adaptatif)
 * ---------------------------------------------------------------------------
 * @param {string} jobId
 * @param {{onTick?:(j:any)=>void,minMs?:number,maxMs?:number}} opts
 */
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

/** ---------------------------------------------------------------------------
 *  Helpers d’URL pour viewer/streaming (backend file & stream routes)
 * ------------------------------------------------------------------------- */
/**
 * URL d’accès direct au fichier (PDF inline, doc, etc.)
 * @param {string} docId
 * @returns {string}
 */
export function fileUrl(docId) {
  return `/api/ask-veeva/file/${encodeURIComponent(docId)}`;
}

/**
 * URL de streaming vidéo (gère les Range requests côté serveur)
 * @param {string} docId
 * @returns {string}
 */
export function streamUrl(docId) {
  return `/api/ask-veeva/stream/${encodeURIComponent(docId)}`;
}

/** ---------------------------------------------------------------------------
 *  util interne pour multipart
 * ------------------------------------------------------------------------- */
async function fetchPathForm(path, formData, timeoutMs = 30000) {
  const res = await withTimeoutFetch(path, {
    method: "POST",
    body: formData,
    credentials: "include",
  }, timeoutMs);

  if (!res.ok) {
    const maybeJson = await tryJson(res);
    if (maybeJson?.error) throw new Error(maybeJson.error);
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await tryJson(res)) ?? null;
}
