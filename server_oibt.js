// server_oibt.js
// Backend OIBT - stockage JSON + uploads (sans DB)
// Dossiers créés automatiquement: ./data/oibt-store.json, ./uploads/oibt

const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const express = require("express");
const multer = require("multer");

const DATA_DIR = path.resolve(process.cwd(), "data");
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "oibt");
const STORE_FILE = path.join(DATA_DIR, "oibt-store.json");

// --- Utils FS
async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fsp.access(STORE_FILE, fs.constants.F_OK);
  } catch {
    const init = { projects: [], periodics: [], seq: 1 };
    await fsp.writeFile(STORE_FILE, JSON.stringify(init, null, 2), "utf-8");
  }
}
async function readStore() {
  await ensureDirs();
  const raw = await fsp.readFile(STORE_FILE, "utf-8");
  return JSON.parse(raw);
}
async function writeStore(store) {
  await ensureDirs();
  await fsp.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// --- Helpers
function getSite(req) {
  return (req.headers["x-site"] || req.query.site || "Nyon").toString();
}
function nowISO() {
  return new Date().toISOString();
}
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // gérer fin de mois
  if (d.getDate() < day) d.setDate(0);
  return d;
}
function formatDDMMYYYY(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yr = d.getFullYear();
  return `${day}/${mo}/${yr}`;
}
function autoYear(obj) {
  try {
    const d = new Date(obj?.created_at || obj?.createdAt || Date.now());
    if (!isNaN(d)) return d.getFullYear();
  } catch {}
  return new Date().getFullYear();
}
function sanitizeKey(k) {
  const s = String(k || "").toLowerCase();
  if (["avis", "protocole", "rapport", "reception"].includes(s)) return s;
  return s;
}
function makeProjectActions() {
  return [
    { key: "avis", name: "Avis d’installation", done: false },
    { key: "protocole", name: "Protocole de mesure", done: false },
    { key: "rapport", name: "Rapport de sécurité", done: false },
    { key: "reception", name: "Contrôle de réception", done: false, due: null },
  ];
}

// --- Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = req.params.id || "unknown";
    const type = sanitizeKey(req.query.type || req.query.action || "file");
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "upload", ext).slice(0, 80);
    const ts = Date.now();
    cb(null, `${id}_${type}_${ts}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// -------------------- Router
function registerOibt(app) {
  const router = express.Router();

  // sanity ping
  router.get("/health", (_req, res) => res.json({ ok: true }));

  // ------------- PROJECTS
  // List
  router.get("/projects", async (req, res) => {
    try {
      const site = getSite(req);
      const store = await readStore();
      const out = store.projects.filter(p => (p.site || "Nyon") === site);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: "List failed", details: String(e?.message || e) });
    }
  });

  // Create
  router.post("/projects", express.json(), async (req, res) => {
    try {
      const site = getSite(req);
      const title = (req.body?.title || "").toString().trim();
      if (!title) return res.status(400).json({ error: "title required" });

      const store = await readStore();
      const id = store.seq++;
      const created_at = nowISO();
      const year = Number(req.body?.year ?? new Date().getFullYear());

      const project = {
        id,
        site,
        title,
        created_at,
        updated_at: created_at,
        year,
        status: makeProjectActions(),
        attachments: {}, // { avis: "filename", ... }
      };
      store.projects.unshift(project);
      await writeStore(store);
      res.json(project);
    } catch (e) {
      res.status(500).json({ error: "Create failed", details: String(e?.message || e) });
    }
  });

  // Update (status, year, title)
  router.put("/projects/:id", express.json(), async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const store = await readStore();
      const idx = store.projects.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      const p = store.projects[idx];
      let status = Array.isArray(req.body?.status) ? req.body.status : p.status;
      // normaliser keys
      status = status.map(a => ({
        key: sanitizeKey(a.key || a.name),
        name: a.name || a.key,
        done: !!a.done,
        due: a.due || null,
      }));
      const year = req.body?.year != null ? Number(req.body.year) : (p.year ?? autoYear(p));
      const title = req.body?.title ? String(req.body.title) : p.title;

      // règle backend: si "rapport" est done et "reception" n'a pas d'échéance -> +6 mois
      const rapport = status.find(a => a.key === "rapport");
      const reception = status.find(a => a.key === "reception");
      if (rapport?.done && reception && !reception.due) {
        const due = addMonths(new Date(), 6);
        reception.due = formatDDMMYYYY(due);
      }

      const updated = {
        ...p,
        title,
        year,
        status,
        updated_at: nowISO(),
      };
      store.projects[idx] = updated;
      await writeStore(store);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: "Update failed", details: String(e?.message || e) });
    }
  });

  // Delete
  router.delete("/projects/:id", async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const store = await readStore();
      const idx = store.projects.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      // supprimer fichiers liés
      const att = store.projects[idx].attachments || {};
      await Promise.all(
        Object.values(att).map(async (fn) => {
          if (!fn) return;
          const fp = path.join(UPLOAD_DIR, fn);
          try { await fsp.unlink(fp); } catch {}
        })
      );

      store.projects.splice(idx, 1);
      await writeStore(store);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Delete failed", details: String(e?.message || e) });
    }
  });

  // Upload file for a project action
  // POST /api/oibt/projects/:id/upload?action=avis|protocole|rapport|reception
  router.post("/projects/:id/upload", upload.single("file"), async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const action = sanitizeKey(req.query.action);

      if (!["avis", "protocole", "rapport", "reception"].includes(action)) {
        return res.status(400).json({ error: "invalid action" });
      }
      if (!req.file) return res.status(400).json({ error: "file required" });

      const store = await readStore();
      const idx = store.projects.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      const p = store.projects[idx];
      const attachments = { ...(p.attachments || {}) };
      attachments[action] = req.file.filename;

      // coche auto l'étape correspondante
      const status = (p.status || []).map(a =>
        sanitizeKey(a.key) === action ? { ...a, done: true } : a
      );

      // si upload "rapport" => fixer due de "reception" à +6 mois si absent
      const rec = status.find(a => a.key === "reception");
      if (action === "rapport" && rec && !rec.due) {
        rec.due = formatDDMMYYYY(addMonths(new Date(), 6));
      }

      const updated = { ...p, attachments, status, updated_at: nowISO() };
      store.projects[idx] = updated;
      await writeStore(store);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: "Upload failed", details: String(e?.message || e) });
    }
  });

  // Download project file
  router.get("/projects/:id/download", async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const action = sanitizeKey(req.query.action);

      const store = await readStore();
      const p = store.projects.find(x => x.id === id && (x.site || "Nyon") === site);
      if (!p) return res.status(404).json({ error: "Not found" });

      const fn = p.attachments?.[action];
      if (!fn) return res.status(404).json({ error: "Attachment not found" });

      const fp = path.join(UPLOAD_DIR, fn);
      return res.sendFile(fp);
    } catch (e) {
      res.status(500).json({ error: "Download failed", details: String(e?.message || e) });
    }
  });

  // ------------- PERIODICS
  // List
  router.get("/periodics", async (req, res) => {
    try {
      const site = getSite(req);
      const store = await readStore();
      const out = store.periodics.filter(p => (p.site || "Nyon") === site);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: "List failed", details: String(e?.message || e) });
    }
  });

  // Create
  router.post("/periodics", express.json(), async (req, res) => {
    try {
      const site = getSite(req);
      const building = (req.body?.building || "").toString().trim();
      if (!building) return res.status(400).json({ error: "building required" });

      const store = await readStore();
      const id = store.seq++;
      const created_at = nowISO();
      const year = Number(req.body?.year ?? new Date().getFullYear());

      const row = {
        id,
        site,
        building,
        created_at,
        updated_at: created_at,
        year,
        // flags + files
        report_received: false,
        report_received_at: null,
        has_report: false,

        defect_report_received: false,
        has_defect: false,

        confirmation_received: false,
        has_confirmation: false,

        files: { report: null, defect: null, confirmation: null },
      };
      store.periodics.unshift(row);
      await writeStore(store);
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: "Create failed", details: String(e?.message || e) });
    }
  });

  // Update
  router.put("/periodics/:id", express.json(), async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const store = await readStore();
      const idx = store.periodics.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      const row = store.periodics[idx];

      const next = {
        ...row,
        report_received: req.body?.report_received ?? row.report_received,
        defect_report_received: req.body?.defect_report_received ?? row.defect_report_received,
        confirmation_received: req.body?.confirmation_received ?? row.confirmation_received,
        year: req.body?.year != null ? Number(req.body.year) : (row.year ?? autoYear(row)),
        updated_at: nowISO(),
      };

      // si report passe à true et pas de date -> timestamp
      if (next.report_received && !row.report_received_at) {
        next.report_received_at = nowISO();
      }

      store.periodics[idx] = next;
      await writeStore(store);
      res.json(next);
    } catch (e) {
      res.status(500).json({ error: "Update failed", details: String(e?.message || e) });
    }
  });

  // Delete
  router.delete("/periodics/:id", async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const store = await readStore();
      const idx = store.periodics.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      const files = store.periodics[idx].files || {};
      await Promise.all(
        Object.values(files).map(async (fn) => {
          if (!fn) return;
          const fp = path.join(UPLOAD_DIR, fn);
          try { await fsp.unlink(fp); } catch {}
        })
      );

      store.periodics.splice(idx, 1);
      await writeStore(store);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Delete failed", details: String(e?.message || e) });
    }
  });

  // Upload periodic file
  // POST /api/oibt/periodics/:id/upload?type=report|defect|confirmation
  router.post("/periodics/:id/upload", upload.single("file"), async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const type = sanitizeKey(req.query.type);
      if (!["report", "defect", "confirmation"].includes(type)) {
        return res.status(400).json({ error: "invalid type" });
      }
      if (!req.file) return res.status(400).json({ error: "file required" });

      const store = await readStore();
      const idx = store.periodics.findIndex(p => p.id === id && (p.site || "Nyon") === site);
      if (idx < 0) return res.status(404).json({ error: "Not found" });

      const row = store.periodics[idx];
      const files = { ...(row.files || {}) };
      files[type] = req.file.filename;

      const next = { ...row, files, updated_at: nowISO() };

      if (type === "report") {
        next.has_report = true;
        next.report_received = true;
        if (!next.report_received_at) next.report_received_at = nowISO();
      } else if (type === "defect") {
        next.has_defect = true;
        next.defect_report_received = true;
      } else if (type === "confirmation") {
        next.has_confirmation = true;
        next.confirmation_received = true;
      }

      store.periodics[idx] = next;
      await writeStore(store);
      res.json(next);
    } catch (e) {
      res.status(500).json({ error: "Upload failed", details: String(e?.message || e) });
    }
  });

  // Download periodic file
  router.get("/periodics/:id/download", async (req, res) => {
    try {
      const site = getSite(req);
      const id = Number(req.params.id);
      const type = sanitizeKey(req.query.type);

      const store = await readStore();
      const row = store.periodics.find(x => x.id === id && (x.site || "Nyon") === site);
      if (!row) return res.status(404).json({ error: "Not found" });

      const fn = row.files?.[type];
      if (!fn) return res.status(404).json({ error: "Attachment not found" });

      const fp = path.join(UPLOAD_DIR, fn);
      return res.sendFile(fp);
    } catch (e) {
      res.status(500).json({ error: "Download failed", details: String(e?.message || e) });
    }
  });

  app.use("/api/oibt", router);
}

module.exports = { registerOibt };
