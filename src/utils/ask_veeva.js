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
 * ASK (RAG) — wide by default (k=0), optional doc focus (docFilter: uuid[])
 * Mirrors backend: returns { ok, text, citations, contexts, suggestions }
 */
export async function ask(question, k = 0, docFilter = []) {
  return post("/api/ask-veeva/ask", { question, k, docFilter });
}

/**
 * Simple vector search (kept for compatibility, but you can ignore it if you rely only on ask()).
 * @param {string} query
 * @param {number} k
 */
export async function search(query, k = 10) {
  return post("/api/ask-veeva/search", { query, k });
}

/**
 * Fuzzy doc finder — used for “Vouliez-vous dire…”
 * Backend route supports q= (string). Returns array of { id, filename, mime? }.
 */
export async function findDocs(q) {
  const qs = new URLSearchParams({ q: q ?? "" }).toString();
  return get(`/api/ask-veeva/find-docs?${qs}`);
}

/* ------------------------------ Uploads ------------------------------ */

/** Upload direct (ZIP <= ~300MB server-side, or any small file) */
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
 * Chunked upload for very large ZIP files.
 * onProgress receives { uploadedBytes, totalBytes } (and you can compute %).
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

  // 2) stream parts
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
          await sleep(400 * (attempt + 1)); // simple backoff
        }
      }
      if (lastErr) throw lastErr;

      uploadedBytes += blob.size;
      onProgress({ uploadedBytes, totalBytes: file.size });
    }

    // 3) complete
    const complete = await post("/api/ask-veeva/chunked/complete", {
      uploadId,
      totalParts,
      originalName: file.name,
    });
    return complete; // { ok, job_id }
  } catch (e) {
    // Try to abort cleanly
    try {
      await post("/api/ask-veeva/chunked/abort", { uploadId, upto: totalParts });
    } catch {}
    throw e;
  }
}

/** Poll job until done/error (adaptive backoff) */
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

/* ------------------------------ Viewer helpers ------------------------------ */

/** Build URL to preview/download a stored file by doc id */
export function buildFileURL(docId) {
  return `/api/ask-veeva/file/${docId}`;
}

/** Build URL to stream a video by doc id */
export function buildStreamURL(docId) {
  return `/api/ask-veeva/stream/${docId}`;
}
