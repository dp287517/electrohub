// src/utils/ask_veeva.js
import { apiBaseFetchJSON, api } from "../lib/api.js";

/** ——————————————————————————————————————————————————————————————
 *  UPLOAD — direct (petits fichiers <= 300 Mo)
 *  - .zip -> /uploadZip
 *  - autres (.pdf/.docx/.xlsx/.xls/.csv/.txt/.mp4) -> /uploadFile
 * —————————————————————————————————————————————————————————————— */
export async function uploadDirect(file) {
  const isZip = /\.zip$/i.test(file.name);
  const fd = new FormData();
  fd.append(isZip ? "zip" : "file", file);

  const url = isZip ? "/api/ask-veeva/uploadZip" : "/api/ask-veeva/uploadFile";
  const res = await fetch(url, { method: "POST", body: fd, credentials: "include" });
  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof payload === "string" ? payload : (payload?.error || `HTTP ${res.status}`));
  return payload; // { ok, job_id, ... }
}

/** ——————————————————————————————————————————————————————————————
 *  UPLOAD — fractionné sans S3 (gros ZIP, > 300 Mo)
 *  - init -> part -> complete
 *  - onProgress({ part, totalParts, progress })
 * —————————————————————————————————————————————————————————————— */
export async function uploadZipChunked(file, onProgress) {
  // 1) init
  const init = await apiBaseFetchJSON(`/api/ask-veeva/chunked/init`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, size: file.size }),
  });
  if (!init?.ok) throw new Error(init?.error || "chunked init failed");
  const { uploadId, partSize } = init;
  const PS = partSize || 10 * 1024 * 1024;

  // 2) parts
  const totalParts = Math.ceil(file.size / PS);
  let uploaded = 0;
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * PS;
    const end = Math.min(file.size, start + PS);
    const blob = file.slice(start, end);

    const fd = new FormData();
    fd.append("chunk", blob, `${file.name}.part${partNumber}`);

    const res = await fetch(`/api/ask-veeva/chunked/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      await abortChunked(uploadId, partNumber).catch(() => {});
      throw new Error(txt || `HTTP ${res.status} on part ${partNumber}`);
    }

    uploaded += blob.size;
    if (onProgress) onProgress({ part: partNumber, totalParts, progress: (uploaded / file.size) * 100 });
  }

  // 3) complete
  const done = await apiBaseFetchJSON(`/api/ask-veeva/chunked/complete`, {
    method: "POST",
    body: JSON.stringify({ uploadId, totalParts, originalName: file.name }),
  });
  if (!done?.ok) throw new Error(done?.error || "chunked complete failed");
  return { job_id: done.job_id };
}

async function abortChunked(uploadId, upto) {
  try {
    await apiBaseFetchJSON(`/api/ask-veeva/chunked/abort`, {
      method: "POST",
      body: JSON.stringify({ uploadId, upto }),
    });
  } catch {}
}

/** ——————————————————————————————————————————————————————————————
 *  UPLOAD — helper auto : si ZIP > 300 Mo -> chunked, sinon direct
 *  onProgress pour le mode chunked uniquement (direct = prog navigateur)
 * —————————————————————————————————————————————————————————————— */
export async function uploadSmart(file, onProgress) {
  const isZip = /\.zip$/i.test(file.name);
  if (isZip && file.size > 300 * 1024 * 1024) {
    // gros ZIP → chunked
    return await uploadZipChunked(file, onProgress);
  }
  // sinon uploadDirect (ZIP ou fichiers unitaires)
  return await uploadDirect(file);
}

/** ——————————————————————————————————————————————————————————————
 *  JOBS — polling
 * —————————————————————————————————————————————————————————————— */
export function pollJob(job_id, { intervalMS = 1500, onTick } = {}) {
  let stop = false;
  async function tick() {
    if (stop) return;
    try {
      const j = await api.askVeeva.job(job_id);
      onTick && onTick(j);
      if (j.status === "done" || j.status === "error") return;
    } catch (e) {
      // ignore transient errors
    }
    setTimeout(tick, intervalMS);
  }
  tick();
  return () => { stop = true; };
}
