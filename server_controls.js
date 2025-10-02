// server_controls.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import { stringify } from 'csv-stringify/sync';

dotenv.config();

const app = express();
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,User');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Multer (fichiers attachés aux tâches)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

// ---------- Données en mémoire (mock DB) ----------
let TASKS = [
  {
    id: 1,
    title: "Inspection HV Switchgear",
    building: "B11",
    category: "HV",
    container: "Main HV Room",
    status: "open",
    created_at: new Date().toISOString(),
    due_date: "2025-12-01",
    operator: null,
    results: {},
    locked: false,
    attachments: []
  }
];
let HISTORY = [];

const CATEGORIES = ["HV", "LV", "ATEX", "UPS", "Motors", "Transformers", "Batteries"];
const BUILDINGS = ["B06", "B11", "B12", "B20"];
const CONTAINERS = ["Main HV Room", "Substation", "Production Hall", "Warehouse"];

// ---------- Helpers ----------
function checklistForCategory(cat) {
  switch (cat) {
    case "HV": return [
      "Visual inspection (no overheating, leaks, rodents)",
      "Thermography (busbar, VT, cable boxes)",
      "Partial discharge test",
      "Circuit breaker operation & interlocks",
      "Insulation resistance > 2 GΩ",
      "Contact resistance measurement",
      "Time travel curve vs manufacturer"
    ];
    case "LV": return [
      "Visual inspection (no smell, dust, water)",
      "Trip unit settings checked",
      "IR test between phases and earth",
      "Mechanical operation of MCCB/ACB",
      "Check selectivity & discrimination"
    ];
    case "ATEX": return [
      "ATEX marking compliance vs zone",
      "Check IP rating",
      "Visual inspection (corrosion, dust)",
      "Cables & glands integrity",
      "Functional check of protection"
    ];
    case "UPS": return [
      "Battery voltage check",
      "Bypass operation test",
      "Load transfer test",
      "Alarm and monitoring functional",
      "Capacitor condition"
    ];
    case "Motors": return [
      "Visual inspection (housing, cooling)",
      "IR test stator winding",
      "Bearing vibration measurement",
      "Temperature sensors test",
      "Phase balance check"
    ];
    case "Transformers": return [
      "Oil sample test (DGA, moisture, dielectric strength)",
      "Partial discharge test",
      "Winding insulation resistance",
      "Check silica gel breather",
      "Cooling fans & pumps functional",
      "Tap changer inspection"
    ];
    case "Batteries": return [
      "Visual inspection (leaks, corrosion)",
      "Cell voltage measurement",
      "Capacity test",
      "Electrolyte level",
      "Ventilation system functional"
    ];
    default: return ["General visual inspection", "Basic insulation test"];
  }
}

// ---------- API ----------

// Health
app.get('/api/controls/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Suggestions
app.get('/api/controls/suggests', (_req, res) => {
  res.json({
    building: BUILDINGS,
    category: CATEGORIES,
    container: CONTAINERS
  });
});

// Entities (arborescence)
app.get('/api/controls/entities', (_req, res) => {
  const data = BUILDINGS.map(b => ({
    name: b,
    categories: CATEGORIES.map(c => ({
      name: c,
      containers: CONTAINERS.map(ct => ({
        name: ct,
        tasks: TASKS.filter(t => t.building === b && t.category === c && t.container === ct)
      }))
    }))
  }));
  res.json(data);
});

// Liste des tâches
app.get('/api/controls/tasks', (req, res) => {
  const { building, category, container, status, q } = req.query;
  let rows = [...TASKS];
  if (building) rows = rows.filter(t => t.building === building);
  if (category) rows = rows.filter(t => t.category === category);
  if (container) rows = rows.filter(t => t.container === container);
  if (status) rows = rows.filter(t => t.status === status);
  if (q) rows = rows.filter(t =>
    (t.title || "").toLowerCase().includes(q.toLowerCase())
  );
  res.json(rows);
});

// Détails avec checklist
app.get('/api/controls/tasks/:id/details', (req, res) => {
  const task = TASKS.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json({ ...task, checklist: checklistForCategory(task.category) });
});

// Upload fichiers
app.post('/api/controls/tasks/:id/upload', upload.array('files'), (req, res) => {
  const task = TASKS.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.locked) return res.status(400).json({ error: "Task is locked" });

  const files = (req.files || []).map(f => ({
    id: Date.now() + "_" + f.originalname,
    filename: f.originalname,
    size: f.size,
    mimetype: f.mimetype,
    buffer: f.buffer,
    uploaded_at: new Date().toISOString()
  }));
  task.attachments.push(...files);
  res.json({ uploaded: files.length });
});

// Lister pièces jointes
app.get('/api/controls/tasks/:id/attachments', (req, res) => {
  const task = TASKS.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json(task.attachments.map(a => ({
    id: a.id,
    filename: a.filename,
    size: a.size,
    mimetype: a.mimetype,
    uploaded_at: a.uploaded_at
  })));
});

// Supprimer pièce jointe
app.delete('/api/controls/attachments/:attId', (req, res) => {
  for (const task of TASKS) {
    const idx = task.attachments.findIndex(a => a.id === req.params.attId);
    if (idx !== -1) {
      task.attachments.splice(idx, 1);
      return res.json({ success: true });
    }
  }
  res.status(404).json({ error: "Not found" });
});

// Compléter une tâche (figer)
app.post('/api/controls/tasks/:id/complete', (req, res) => {
  const task = TASKS.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.locked) return res.status(400).json({ error: "Already completed" });

  task.status = "completed";
  task.locked = true;
  task.operator = req.body.user || "unknown";
  task.results = req.body.results || {};
  task.completed_at = new Date().toISOString();

  HISTORY.push({
    id: HISTORY.length + 1,
    task_id: task.id,
    user: task.operator,
    results: task.results,
    date: task.completed_at
  });

  res.json({ message: "Task completed" });
});

// Historique
app.get('/api/controls/history', (req, res) => {
  const { user, q } = req.query;
  let rows = [...HISTORY];
  if (user) rows = rows.filter(h => h.user === user);
  if (q) rows = rows.filter(h =>
    JSON.stringify(h.results).toLowerCase().includes(q.toLowerCase())
  );
  res.json(rows);
});

// Export CSV de l’historique
app.get('/api/controls/history/export', (_req, res) => {
  const csv = stringify(HISTORY, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=history.csv');
  res.send(csv);
});

// Analytics
app.get('/api/controls/analytics', (_req, res) => {
  const total = TASKS.length;
  const completed = TASKS.filter(t => t.status === "completed").length;
  const open = total - completed;
  const byBuilding = {};
  for (const b of BUILDINGS) {
    byBuilding[b] = TASKS.filter(t => t.building === b).length;
  }
  const byCategory = {};
  for (const c of CATEGORIES) {
    byCategory[c] = TASKS.filter(t => t.category === c).length;
  }
  res.json({ total, open, completed, byBuilding, byCategory });
});

// Roadmap
app.get('/api/controls/roadmap', (_req, res) => {
  res.json([
    { id: 1, title: "Q1 2025 - HV Inspections", start: "2025-01-01", end: "2025-03-31" },
    { id: 2, title: "Q2 2025 - ATEX checks", start: "2025-04-01", end: "2025-06-30" },
    { id: 3, title: "Q3 2025 - UPS & Battery", start: "2025-07-01", end: "2025-09-30" },
    { id: 4, title: "Q4 2025 - Global Audit", start: "2025-10-01", end: "2025-12-31" }
  ]);
});

// Assistant IA (stub, prêt pour OpenAI)
app.post('/api/controls/ai/assistant', (req, res) => {
  const { mode, text } = req.body;
  if (mode === "vision") {
    return res.json({ suggestion: "IR measured at 2.3 GΩ - compliant." });
  }
  if (mode === "text") {
    return res.json({ reply: `Assistant: I read your message "${text}" and I suggest to check insulation.` });
  }
  res.status(400).json({ error: "Unknown mode" });
});

// ---------- Start ----------
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] server listening on :${port}`));
