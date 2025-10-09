// src/utils/ask_veeva.js
import { apiBaseFetchJSON } from "../lib/api.js";

/** Envoi direct (petits ZIP) */
export async function uploadZipSmall(file) {
  const fd = new FormData();
  fd.append("zip", file);
  const res = await fetch(`/api/ask-veeva/uploadZip`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(humanizeHttpError(res.status, txt));
  }
  return res.json();
}

/** Multipart S3 pour gros ZIP */
export async function uploadZipMultipartS3(file, onProgress /* ({part, totalParts, progress}) */) {
  // 1) create
  const createOut = await apiBaseFetchJSON(`/api/ask-veeva/multipart/create`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, contentType: "application/zip" })
  });
  if (!createOut?.ok) throw new Error(createOut?.error || "multipart create failed");
  const { uploadId, key } = createOut;

  // 2) découpage (5–64MB)
  const PART_SIZE = 10 * 1024 * 1024; // 10 MB
  const totalParts = Math.ceil(file.size / PART_SIZE);
  const etags = [];
  let uploadedBytes = 0;

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * PART_SIZE;
    const end = Math.min(file.size, start + PART_SIZE);
    const blob = file.slice(start, end);

    const sign = await apiBaseFetchJSON(`/api/ask-veeva/multipart/sign`, {
      method: "POST",
      body: JSON.stringify({ key, uploadId, partNumber })
    });
    if (!sign?.ok) throw new Error(sign?.error || `sign failed (part ${partNumber})`);
    const putUrl = sign.url;

    // Upload la part en PUT direct S3
    const putRes = await fetch(putUrl, { method: "PUT", body: blob });
    if (!putRes.ok) {
      const txt = await safeText(putRes);
      await abortSafe(key, uploadId).catch(()=>{});
      throw new Error(`S3 upload part ${partNumber} failed: ${txt}`);
    }
    const etag = putRes.headers.get("etag") || putRes.headers.get("ETag");
    if (!etag) {
      await abortSafe(key, uploadId).catch(()=>{});
      throw new Error(`Missing ETag for part ${partNumber}`);
    }
    etags.push({ PartNumber: partNumber, ETag: etag.replaceAll('"', '') });

    uploadedBytes += blob.size;
    if (onProgress) {
      onProgress({
        part: partNumber,
        totalParts,
        progress: (uploadedBytes / file.size) * 100
      });
    }
  }

  // 3) complete
  const completeOut = await apiBaseFetchJSON(`/api/ask-veeva/multipart/complete`, {
    method: "POST",
    body: JSON.stringify({ key, uploadId, parts: etags })
  });
  if (!completeOut?.ok) throw new Error(completeOut?.error || "multipart complete failed");

  return { job_id: completeOut.job_id };
}

async function abortSafe(key, uploadId) {
  try {
    await apiBaseFetchJSON(`/api/ask-veeva/multipart/abort`, {
      method: "POST",
      body: JSON.stringify({ key, uploadId })
    });
  } catch {}
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}

function humanizeHttpError(status, bodyText) {
  // Si Render renvoie une page HTML (<pre>Internal Server Error</pre>), on simplifie
  const htmlish = /<\/?(html|head|body|pre|title)/i.test(bodyText || "");
  if (htmlish) {
    if (status === 413) return "Fichier trop volumineux (413) — utilisez le mode S3 multipart.";
    if (status === 502) return "Passerelle indisponible (502) — réessaye ou bascule en S3 multipart.";
    return `Erreur serveur (${status})`;
  }
  // Sinon on renvoie le message utile
  if (status === 413) return "Fichier trop volumineux (413) — utilisez le mode S3 multipart.";
  if (status === 502) return "Service indisponible (502) — réessaye ou bascule en S3 multipart.";
  return bodyText || `HTTP ${status}`;
}
