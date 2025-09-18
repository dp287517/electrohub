/**
 * server_atex.js
 * ATEX routes:
 * - Equipment CRUD
 * - Assessment list
 * - Excel import/export
 * JSON-file persistence for simple deployments.
 */
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const EQUIP_FILE = path.join(DATA_DIR, "atex_equipments.json");
const ASSESS_FILE = path.join(DATA_DIR, "atex_assessments.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EQUIP_FILE)) fs.writeFileSync(EQUIP_FILE, "[]", "utf8");
if (!fs.existsSync(ASSESS_FILE)) fs.writeFileSync(ASSESS_FILE, "[]", "utf8");

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8") || "[]"); }
  catch { return []; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// ---- Equipment CRUD ----
router.get("/equipment", (_req, res) => {
  const items = readJSON(EQUIP_FILE);
  res.json({ items });
});

router.post("/equipment", (req, res) => {
  const items = readJSON(EQUIP_FILE);
  const now = new Date().toISOString();
  const {
    name, area, zone, category, temperatureClass, protectionLevel,
    marking, notes
  } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing 'name'." });
  const item = {
    id: randomUUID(),
    name, area: area || "", zone: zone || "",
    category: category || "", temperatureClass: temperatureClass || "",
    protectionLevel: protectionLevel || "", marking: marking || "",
    notes: notes || "", createdAt: now, updatedAt: now
  };
  items.push(item);
  writeJSON(EQUIP_FILE, items);
  res.status(201).json({ item });
});

router.put("/equipment/:id", (req, res) => {
  const { id } = req.params;
  const items = readJSON(EQUIP_FILE);
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const now = new Date().toISOString();
  items[idx] = { ...items[idx], ...req.body, id, updatedAt: now };
  writeJSON(EQUIP_FILE, items);
  res.json({ item: items[idx] });
});

router.delete("/equipment/:id", (req, res) => {
  const { id } = req.params;
  const items = readJSON(EQUIP_FILE);
  const next = items.filter(x => x.id !== id);
  writeJSON(EQUIP_FILE, next);
  res.json({ ok: true });
});

// ---- Assessments ----
router.get("/assessment", (_req, res) => {
  const items = readJSON(ASSESS_FILE);
  res.json({ items });
});

router.post("/assessment", (req, res) => {
  const list = readJSON(ASSESS_FILE);
  const now = new Date().toISOString();
  const {
    equipmentId, riskLevel, probability, consequence, measures, reviewer
  } = req.body || {};
  if (!equipmentId) return res.status(400).json({ error: "Missing 'equipmentId'." });
  const item = {
    id: randomUUID(),
    equipmentId, riskLevel: riskLevel || "Unknown",
    probability: probability ?? null, consequence: consequence ?? null,
    measures: measures || "", reviewer: reviewer || "",
    createdAt: now, updatedAt: now
  };
  list.push(item);
  writeJSON(ASSESS_FILE, list);
  res.status(201).json({ item });
});

// ---- Excel Export ----
router.get("/export", (_req, res) => {
  const equipments = readJSON(EQUIP_FILE);
  const assessments = readJSON(ASSESS_FILE);

  const wb = XLSX.utils.book_new();
  const equipSheet = XLSX.utils.json_to_sheet(equipments);
  const assessSheet = XLSX.utils.json_to_sheet(assessments);
  XLSX.utils.book_append_sheet(wb, equipSheet, "Equipment");
  XLSX.utils.book_append_sheet(wb, assessSheet, "Assessments");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=atex_export.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// ---- Excel Import ----
router.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const wb = XLSX.read(req.file.buffer, { type: "buffer" });
  // Accept both sheets, if present
  if (wb.Sheets["Equipment"]) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets["Equipment"]);
    // normalize minimal fields
    const now = new Date().toISOString();
    const mapped = data.map((r) => ({
      id: r.id || randomUUID(),
      name: String(r.name || "").trim(),
      area: String(r.area || ""),
      zone: String(r.zone || ""),
      category: String(r.category || ""),
      temperatureClass: String(r.temperatureClass || ""),
      protectionLevel: String(r.protectionLevel || ""),
      marking: String(r.marking || ""),
      notes: String(r.notes || ""),
      createdAt: r.createdAt || now,
      updatedAt: now
    })).filter(x => x.name);
    writeJSON(EQUIP_FILE, mapped);
  }
  if (wb.Sheets["Assessments"]) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets["Assessments"]);
    const now = new Date().toISOString();
    const mapped = data.map((r) => ({
      id: r.id || randomUUID(),
      equipmentId: String(r.equipmentId || "").trim(),
      riskLevel: String(r.riskLevel || "Unknown"),
      probability: r.probability ?? null,
      consequence: r.consequence ?? null,
      measures: String(r.measures || ""),
      reviewer: String(r.reviewer || ""),
      createdAt: r.createdAt || now,
      updatedAt: now
    })).filter(x => x.equipmentId);
    writeJSON(ASSESS_FILE, mapped);
  }
  res.json({ ok: true });
});

export default router;
