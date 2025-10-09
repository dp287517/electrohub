// src/utils/ask_veeva.js
import { get, post } from "../lib/api.js";

/** ---- API simple ---- */
export async function health() {
  return get("/api/ask-veeva/health");
}

export async function search(query, k = 6) {
  return post("/api/ask-veeva/search", { query, k });
}

export async function ask(question, k = 6) {
  return post("/api/ask-veeva/ask", { question, k });
}

/** ---- Upload direct (petits fichiers / ZIP <= 300 Mo côté serveur) ---- */
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

/** ---- Upload fractionné (gros ZIP) ---- */
export async function chunkedUpload(file, opts = {}) {
  const { onProgress = () => {} } = opts;

  // 1) init
  const initRes = await post("/api/ask-veeva/chunked/init", {
    filename: file.name,
    size: file.size,
  });
  if (!initRes?.uploadId) throw new Error("Init chunked échoué");
  const { uploadId, partSize } = initRes;

  // 2) part-by-part
  const totalParts = Math.ceil(file.size / partSize);
  let uploadedBytes = 0;

  for (let part = 1; part <= totalParts; part++) {
    const start = (part - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const fd = new FormData();
    fd.append("chunk", blob, `${file.name}.part${part}`);

    const qs = new URLSearchParams({ uploadId, partNumber: String(part) });
    await fetchPathForm(`/api/ask-veeva/chunked/part?${qs.toString()}`, fd);

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
}

/** ---- Poll job ---- */
export function pollJob(jobId, { onTick = () => {} } = {}) {
  let stopped = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loop() {
    while (!stopped) {
      const j = await get(`/api/ask-veeva/jobs/${jobId}`);
      onTick(j);
      if (j.status === "done" || j.status === "error") return j;
      await wait(1200);
    }
  }

  return {
    stop: () => (stopped = true),
    promise: loop(),
  };
}

/** ---- util interne pour multipart ---- */
async function fetchPathForm(path, formData) {
  // on ne passe pas par upload() pour contrôler le path + params
  const res = await fetch(path, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}
