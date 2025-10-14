Directory).length;
      await zip.close();
    } catch { total = 0; }
    const jobId = await createJob("zip", total);
    enqueue(() => runIngestZip(jobId, req.file.path)).catch((e) => console.error("ingest zip fail", e));
    res.json({ ok: true, job_id: jobId, filename: req.file.filename, bytes: st.size });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/ask-veeva/uploadFile", uploadDirect.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file manquant" });
    const jobId = await createJob("file", 1);
    enqueue(() => runIngestSingleFile(jobId, req.file.path, req.file.originalname)).catch((e) =>
      console.error("ingest file fail", e)
    );
    res.json({ ok: true, job_id: jobId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/ask-veeva/chunked/init", async (req, res) => {
  try {
    const { filename, size } = req.body || {};
    if (!filename || !Number.isFinite(size)) return res.status(400).json({ error: "filename/size requis" });
    const uploadId = crypto.randomUUID();
    const manifest = { filename, size, created_at: Date.now() };
    await fsp.writeFile(path.join(PARTS_DIR, `${uploadId}.json`), JSON.stringify(manifest));
    res.json({ ok: true, uploadId, partSize: CHUNK_PART_SIZE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const concatPartsToZip = async (uploadId, totalParts, destZipAbs) => {
  await fsp.mkdir(path.dirname(destZipAbs), { recursive: true });
  const ws = fs.createWriteStream(destZipAbs);
  try {
    for (let i = 1; i <= totalParts; i++) {
      const partPath = path.join(PARTS_DIR, `${uploadId}.${i}.part`);
      const st = await fsp.stat(partPath).catch(() => null);
      if (!st) throw new Error(`Part manquante: #${i}`);
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(partPath);
        rs.on("error", reject);
        rs.on("end", resolve);
        rs.pipe(ws, { end: false });
      });
      global.gc?.();
    }
  } finally {
    ws.end();
  }
};

app.post("/api/ask-veeva/chunked/part", uploadChunk.single("chunk"), async (req, res) => {
  try {
    const { uploadId, partNumber } = req.query || {};
    if (!uploadId || !partNumber) return res.status(400).json({ error: "uploadId/partNumber requis" });
    if (!req.file) return res.status(400).json({ error: "chunk manquant" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const pnum = Number(partNumber);
    if (!Number.isInteger(pnum) || pnum <= 0) return res.status(400).json({ error: "partNumber invalide" });
    const dest = path.join(PARTS_DIR, `${safeId}.${pnum}.part`);
    await fsp.rename(req.file.path, dest);
    res.json({ ok: true, received: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/chunked/complete", async (req, res) => {
  try {
    const { uploadId, totalParts, originalName } = req.body || {};
    if (!uploadId || !totalParts) return res.status(400).json({ error: "uploadId/totalParts requis" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const parts = Number(totalParts);
    if (!Number.isInteger(parts) || parts <= 0) return res.status(400).json({ error: "totalParts invalide" });

    const finalZip = path.join(
      UPLOAD_DIR,
      `chunked_${nowISO()}_${(originalName || "upload.zip").replace(/[^\w.\-]+/g, "_")}`
    );
    await concatPartsToZip(safeId, parts, finalZip);

    let total = 0;
    try {
      const zip = new StreamZip.async({ file: finalZip, storeEntries: true });
      const entries = await zip.entries();
      total = Object.values(entries).filter((e) => !e.isDirectory).length;
      await zip.close();
    } catch { total = 0; }

    const jobId = await createJob("zip-chunked", total);
    enqueue(() => runIngestZip(jobId, finalZip)).catch((e) => console.error("ingest zip chunked fail", e));
    res.json({ ok: true, job_id: jobId });

    (async () => {
      await fsp.rm(path.join(PARTS_DIR, `${safeId}.json`), { force: true }).catch(() => {});
      for (let i = 1; i <= parts; i++) {
        await fsp.rm(path.join(PARTS_DIR, `${safeId}.${i}.part`), { force: true }).catch(() => {});
      }
    })();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/chunked/abort", async (req, res) => {
  try {
    const { uploadId, upto } = req.body || {};
    if (!uploadId) return res.status(400).json({ error: "uploadId requis" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const limit = Number(upto) || 999999;
    await fsp.rm(path.join(PARTS_DIR, `${safeId}.json`), { force: true }).catch(() => {});
    for (let i = 1; i <= limit; i++) {
      await fsp.rm(path.join(PARTS_DIR, `${safeId}.${i}.part`), { force: true }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// FICHIERS : metadata + original + preview
// -----------------------------------------------------------------------------
function sanitizeNameForStore(name = "") { return String(name).replace(/[^\w.\-]+/g, "_"); }
async function tryFindInStoreDirByPattern(originalName) {
  const targetSuffix = "_" + sanitizeNameForStore(originalName);
  const files = await fsp.readdir(STORE_DIR).catch(() => []);
  const candidates = files.filter(fn => fn.endsWith(targetSuffix));
  if (!candidates.length) return null;
  let best = null;
  let bestTime = -1;
  for (const fn of candidates) {
    const p = path.join(STORE_DIR, fn);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.isFile() && st.mtimeMs > bestTime) {
      best = p; bestTime = st.mtimeMs;
    }
  }
  return best;
}

app.get("/api/ask-veeva/filemeta/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).json({ ok:false, error: "doc not found" });

    if (doc.path && fs.existsSync(doc.path)) {
      return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
    }
    const base = path.basename(doc.path || "");
    if (base) {
      const alt = path.join(STORE_DIR, base);
      if (fs.existsSync(alt)) {
        return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
      }
    }
    const guess = await tryFindInStoreDirByPattern(doc.filename);
    if (guess && fs.existsSync(guess)) {
      return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
    }
    const { rows: chunks } = await pool.query(
      `SELECT 1 FROM askv_chunks WHERE doc_id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (chunks.length) {
      return res.json({ ok: true, existsOriginal: false, canPreview: true, url: `/api/ask-veeva/preview/${doc.id}`, mime: "text/html" });
    }
    return res.json({ ok: false, existsOriginal: false, canPreview: false, error: "file not on disk" });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get("/api/ask-veeva/file/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "doc not found" });

    const sendOriginal = (absPath) => {
      if (doc.mime) res.type(doc.mime);
      res.sendFile(path.resolve(absPath));
    };

    if (doc.path && fs.existsSync(doc.path)) {
      return sendOriginal(doc.path);
    }
    const base = path.basename(doc.path || "");
    if (base) {
      const alt = path.join(STORE_DIR, base);
      if (fs.existsSync(alt)) return sendOriginal(alt);
    }
    const guess = await tryFindInStoreDirByPattern(doc.filename);
    if (guess && fs.existsSync(guess)) return sendOriginal(guess);

    const { rows: segs } = await pool.query(
      `SELECT chunk_index, content FROM askv_chunks WHERE doc_id = $1 ORDER BY chunk_index ASC`,
      [req.params.id]
    );
    if (segs.length) {
      const html = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'/>",
        "<title>Preview – ", (doc.filename || "document"), "</title>",
        "<style>",
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.45;padding:16px;color:#111}",
        "h1{font-size:18px;margin:0 0 12px} .chunk{margin:16px 0;padding:12px;border-left:4px solid #e5e7eb;background:#fafafa;white-space:pre-wrap;word-break:break-word}",
        "</style></head><body>",
        "<h1>Prévisualisation (texte indexé)</h1>",
        "<div style='color:#374151;font-size:13px;margin-bottom:8px'><strong>Fichier:</strong> ",
        (doc.filename || doc.id),
        "</div>"
      ];
      const esc = s => String(s || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      for (const s of segs) {
        html.push("<div class='chunk'><div style='color:#9ca3af;font-size:12px'>#",
                  String(s.chunk_index),
                  "</div>", esc(s.content), "</div>");
      }
      html.push("</body></html>");
      res.setHeader("X-AskVeeva-Preview", "1");
      res.type("html").send(html.join(""));
      return;
    }

    res.status(404).json({ error: "file not on disk" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ask-veeva/preview/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).send("Document inconnu.");

    const { rows: segs } = await pool.query(
      `SELECT chunk_index, content FROM askv_chunks WHERE doc_id = $1 ORDER BY chunk_index ASC`,
      [req.params.id]
    );
    if (!segs.length) {
      return res.status(404).send("Aucune donnée indexée disponible pour la prévisualisation.");
    }

    const esc = s => String(s || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const html = [
      "<!doctype html><html><head><meta charset='utf-8'>",
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>",
      "<title>Preview – ", esc(doc.filename || doc.id), "</title>",
      "<style>",
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.45;padding:16px;color:#111}",
      "h1{font-size:18px;margin:0 0 12px} .chunk{margin:16px 0;padding:12px;border-left:4px solid #e5e7eb;background:#fafafa;white-space:pre-wrap;word-break:break-word}",
      "</style></head><body>",
      "<h1>Prévisualisation (texte indexé)</h1>",
      "<div style='color:#374151;font-size:13px;margin-bottom:8px'><strong>Fichier:</strong> ", esc(doc.filename || doc.id), "</div>"
    ];
    for (const s of segs) {
      html.push("<div class='chunk'><div style='color:#9ca3af;font-size:12px'>#",
                String(s.chunk_index),
                "</div>", esc(s.content), "</div>");
    }
    html.push("</body></html>");
    res.setHeader("X-AskVeeva-Preview", "1");
    res.type("html").send(html.join(""));
  } catch (e) {
    res.status(500).send("Erreur preview: " + (e?.message || e));
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[ask-veeva] service listening on ${HOST}:${PORT}`);
});
