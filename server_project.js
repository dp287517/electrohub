// server_project.js (ESM) — Project Manager API (complete)
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import OpenAI from "openai";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ---- OpenAI (optional)
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (e) {
  console.warn("[PROJECT] OpenAI init failed:", e.message);
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// ---- CORS (useful behind gateway or locally)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---- Multi-site
const DEFAULT_SITE = process.env.PROJECT_DEFAULT_SITE || "Nyon";
const siteOf = (req) =>
  (req.header("X-Site") || req.query.site || req.body?.site || "").toString() || DEFAULT_SITE;

// ---- Upload (memory -> DB BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

/* ===================== SCHEMA ===================== */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_projects (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      title TEXT NOT NULL,
      wbs_number TEXT,
      budget_amount NUMERIC,
      prep_month  DATE,
      start_month DATE,
      close_month DATE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_projects_site ON pm_projects(site);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_status (
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      business_case_done BOOLEAN DEFAULT FALSE,
      pip_done           BOOLEAN DEFAULT FALSE,
      offers_received    BOOLEAN DEFAULT FALSE,
      wbs_recorded       BOOLEAN DEFAULT FALSE,
      orders_placed      BOOLEAN DEFAULT FALSE,
      invoices_received  BOOLEAN DEFAULT FALSE,
      last_analysis JSONB,
      PRIMARY KEY (project_id, site)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_offers (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      vendor TEXT,
      amount NUMERIC NOT NULL,
      received_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_orders (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      vendor TEXT,
      amount NUMERIC NOT NULL,
      ordered_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_invoices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      vendor TEXT,
      amount NUMERIC NOT NULL,
      invoiced_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_files (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('business_case','pip','offer','wbs','order','invoice')),
      filename TEXT,
      mime TEXT,
      file BYTEA,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Useful indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_files_project ON pm_files(project_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_offers_project ON pm_offers(project_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_orders_project ON pm_orders(project_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_invoices_project ON pm_invoices(project_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pm_audit (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER REFERENCES pm_projects(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      meta JSONB,
      at TIMESTAMPTZ DEFAULT NOW(),
      actor TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_audit_project ON pm_audit(project_id);`);
}

/* ===================== UTILS ===================== */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
async function logAudit(site, project_id, action, meta = {}, actor = "system") {
  try {
    await pool.query(
      `INSERT INTO pm_audit(site, project_id, action, meta, actor) VALUES ($1,$2,$3,$4,$5)`,
      [site, project_id, action, meta, actor]
    );
  } catch (e) {
    console.warn("[PM AUDIT]", e.message);
  }
}

/* ===================== HEALTH ===================== */
let schemaReady = false;
app.get("/api/projects/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), openai: !!openai, schemaReady })
);

async function tryEnsure() {
  try {
    await ensureSchema();
    schemaReady = true;
    console.log("[PM SCHEMA] OK");
  } catch (e) {
    schemaReady = false;
    console.error("[PM SCHEMA] init failed:", e?.message || e);
  }
}
tryEnsure();
app.post("/api/projects/admin/ensure", async (_req, res) => {
  await tryEnsure();
  res.json({ ok: schemaReady });
});

/* ===================== PROJECTS CRUD ===================== */
app.get("/api/projects/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    const q = String(req.query.q || "").toLowerCase().trim();
    const { rows } = await pool.query(
      q
        ? `SELECT * FROM pm_projects WHERE site=$1 AND LOWER(title) LIKE $2 ORDER BY created_at DESC`
        : `SELECT * FROM pm_projects WHERE site=$1 ORDER BY created_at DESC`,
      q ? [site, `%${q}%`] : [site]
    );

    const ids = rows.map((r) => r.id);
    const sums = ids.length
      ? await pool.query(
          `
        SELECT p.id as project_id,
               COALESCE((SELECT SUM(amount) FROM pm_offers  o WHERE o.project_id=p.id AND o.site=$1),0) AS offers_total,
               COALESCE((SELECT SUM(amount) FROM pm_orders  o WHERE o.project_id=p.id AND o.site=$1),0) AS orders_total,
               COALESCE((SELECT SUM(amount) FROM pm_invoices i WHERE i.project_id=p.id AND i.site=$1),0) AS invoices_total
        FROM pm_projects p WHERE p.site=$1 AND p.id = ANY($2)
      `,
          [site, ids]
        )
      : { rows: [] };
    const byId = Object.fromEntries(sums.rows.map((r) => [r.project_id, r]));

    const st = await pool.query(`SELECT * FROM pm_status WHERE site=$1 AND project_id = ANY($2)`, [site, ids]);
    const statusBy = Object.fromEntries(st.rows.map((r) => [r.project_id, r]));

    res.json({
      data: rows.map((r) => ({
        ...r,
        kpi: byId[r.id] || { offers_total: 0, orders_total: 0, invoices_total: 0 },
        status: statusBy[r.id] || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/projects/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    const { title, wbs_number = null, budget_amount = null } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: "Missing title" });

    const now = new Date();
    const firstOf = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const prep = firstOf(now);
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const close = new Date(now.getFullYear(), now.getMonth() + 2, 1);

    const r = await pool.query(
      `INSERT INTO pm_projects(site,title,wbs_number,budget_amount,prep_month,start_month,close_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [site, title.trim(), wbs_number, budget_amount, prep, start, close]
    );

    await pool.query(`INSERT INTO pm_status(project_id, site) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      r.rows[0].id,
      site,
    ]);
    await logAudit(site, r.rows[0].id, "create_project", { title, wbs_number, budget_amount });

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/projects/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { title, wbs_number, budget_amount, prep_month, start_month, close_month } = req.body || {};
    const r = await pool.query(
      `UPDATE pm_projects SET
         title = COALESCE($1, title),
         wbs_number = COALESCE($2, wbs_number),
         budget_amount = COALESCE($3, budget_amount),
         prep_month = COALESCE($4, prep_month),
         start_month = COALESCE($5, start_month),
         close_month = COALESCE($6, close_month),
         updated_at = NOW()
       WHERE id=$7 AND site=$8
       RETURNING *`,
      [title, wbs_number, budget_amount, prep_month, start_month, close_month, id, site]
    );

    await logAudit(site, id, "update_project", {
      title,
      wbs_number,
      budget_amount,
      prep_month,
      start_month,
      close_month,
    });
    res.json(r.rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/projects/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM pm_projects WHERE id=$1 AND site=$2`, [id, site]);
    await logAudit(site, id, "delete_project");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== STATUS + FILES ===================== */
app.get("/api/projects/projects/:id/status", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM pm_status WHERE site=$1 AND project_id=$2`, [site, id]);
    res.json(rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/projects/projects/:id/status", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const s = req.body || {};
    const r = await pool.query(
      `INSERT INTO pm_status(project_id, site, business_case_done, pip_done, offers_received, wbs_recorded, orders_placed, invoices_received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_id, site) DO UPDATE SET
         business_case_done = EXCLUDED.business_case_done,
         pip_done = EXCLUDED.pip_done,
         offers_received = EXCLUDED.offers_received,
         wbs_recorded = EXCLUDED.wbs_recorded,
         orders_placed = EXCLUDED.orders_placed,
         invoices_received = EXCLUDED.invoices_received
       RETURNING *`,
      [id, site, !!s.business_case_done, !!s.pip_done, !!s.offers_received, !!s.wbs_recorded, !!s.orders_placed, !!s.invoices_received]
    );
    await logAudit(site, id, "update_status", r.rows[0]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/projects/projects/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const category = String(req.query.category || "").toLowerCase();
    if (!["business_case", "pip", "offer", "wbs", "order", "invoice"].includes(category)) {
      return res.status(400).json({ error: "Bad category" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

    await pool.query(
      `INSERT INTO pm_files(site, project_id, category, filename, mime, file)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [site, id, category, req.file.originalname, req.file.mimetype, req.file.buffer]
    );

    // auto-tick status
    const curr = await pool.query(`SELECT * FROM pm_status WHERE site=$1 AND project_id=$2`, [site, id]);
    const prev = curr.rows[0] || {};
    const patch = {
      business_case_done: category === "business_case" || prev.business_case_done || false,
      pip_done:           category === "pip"          || prev.pip_done           || false,
      offers_received:    category === "offer"        || prev.offers_received    || false,
      wbs_recorded:       category === "wbs"          || prev.wbs_recorded       || false,
      orders_placed:      category === "order"        || prev.orders_placed      || false,
      invoices_received:  category === "invoice"      || prev.invoices_received  || false,
    };
    await pool.query(
      `INSERT INTO pm_status(project_id, site, business_case_done, pip_done, offers_received, wbs_recorded, orders_placed, invoices_received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_id, site) DO UPDATE SET
        business_case_done=EXCLUDED.business_case_done,
        pip_done=EXCLUDED.pip_done,
        offers_received=EXCLUDED.offers_received,
        wbs_recorded=EXCLUDED.wbs_recorded,
        orders_placed=EXCLUDED.orders_placed,
        invoices_received=EXCLUDED.invoices_received`,
      [id, site, patch.business_case_done, patch.pip_done, patch.offers_received, patch.wbs_recorded, patch.orders_placed, patch.invoices_received]
    );

    await logAudit(site, id, "upload_file", { category, filename: req.file.originalname });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/projects/:id/files", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const category = String(req.query.category || "");
    const { rows } = await pool.query(
      `SELECT id, filename, mime, uploaded_at FROM pm_files
       WHERE site=$1 AND project_id=$2 AND ($3='' OR category=$3)
       ORDER BY uploaded_at DESC`,
      [site, id, category]
    );
    res.json({ files: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download endpoint (used by the front)
app.get("/api/projects/download", async (req, res) => {
  try {
    const site = siteOf(req);
    const fileId = Number(req.query.file_id);
    const q = await pool.query(`SELECT filename, mime, file FROM pm_files WHERE id=$1 AND site=$2`, [fileId, site]);
    if (!q.rows.length) return res.status(404).send("File not found");
    res.setHeader("Content-Type", q.rows[0].mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(q.rows[0].filename || "file")}"`);
    res.send(q.rows[0].file);
  } catch {
    res.status(500).send("Download failed");
  }
});

// NEW: delete a file (front calls DELETE /api/projects/files/:fileId)
app.delete("/api/projects/files/:fileId", async (req, res) => {
  try {
    const site = siteOf(req);
    const fileId = Number(req.params.fileId);
    const got = await pool.query(`DELETE FROM pm_files WHERE id=$1 AND site=$2 RETURNING project_id, filename`, [fileId, site]);
    if (!got.rows.length) return res.status(404).json({ error: "File not found" });
    await logAudit(site, got.rows[0].project_id, "delete_file", { file_id: fileId, filename: got.rows[0].filename });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== FINANCIAL LINES ===================== */
app.get("/api/projects/projects/:id/lines", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);

    const exists = await pool.query(`SELECT 1 FROM pm_projects WHERE id=$1 AND site=$2`, [id, site]);
    if (!exists.rows.length) return res.status(404).json({ error: "Project not found" });

    const offers = await pool.query(
      `SELECT id, vendor, amount, received_at
         FROM pm_offers
        WHERE site=$1 AND project_id=$2
        ORDER BY received_at DESC, id DESC`,
      [site, id]
    );
    const orders = await pool.query(
      `SELECT id, vendor, amount, ordered_at
         FROM pm_orders
        WHERE site=$1 AND project_id=$2
        ORDER BY ordered_at DESC, id DESC`,
      [site, id]
    );
    const invoices = await pool.query(
      `SELECT id, vendor, amount, invoiced_at
         FROM pm_invoices
        WHERE site=$1 AND project_id=$2
        ORDER BY invoiced_at DESC, id DESC`,
      [site, id]
    );

    res.json({ offers: offers.rows, orders: orders.rows, invoices: invoices.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create lines (already existed)
app.post("/api/projects/projects/:id/offer", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { vendor = null, amount } = req.body || {};
    if (!Number.isFinite(Number(amount))) return res.status(400).json({ error: "amount required" });
    const { rows: [row] } = await pool.query(
      `INSERT INTO pm_offers(site,project_id,vendor,amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [site, id, vendor, num(amount)]
    );
    await logAudit(site, id, "add_offer", row);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/projects/projects/:id/order", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { vendor = null, amount } = req.body || {};
    if (!Number.isFinite(Number(amount))) return res.status(400).json({ error: "amount required" });
    const { rows: [row] } = await pool.query(
      `INSERT INTO pm_orders(site,project_id,vendor,amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [site, id, vendor, num(amount)]
    );
    await logAudit(site, id, "add_order", row);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/projects/projects/:id/invoice", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { vendor = null, amount } = req.body || {};
    if (!Number.isFinite(Number(amount))) return res.status(400).json({ error: "amount required" });
    const { rows: [row] } = await pool.query(
      `INSERT INTO pm_invoices(site,project_id,vendor,amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [site, id, vendor, num(amount)]
    );
    await logAudit(site, id, "add_invoice", row);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NEW: update a line (offer/order/invoice)
app.put("/api/projects/projects/:id/offer/:lineId", async (req, res) => {
  await updateLine("offer", req, res);
});
app.put("/api/projects/projects/:id/order/:lineId", async (req, res) => {
  await updateLine("order", req, res);
});
app.put("/api/projects/projects/:id/invoice/:lineId", async (req, res) => {
  await updateLine("invoice", req, res);
});

// NEW: delete a line
app.delete("/api/projects/projects/:id/offer/:lineId", async (req, res) => {
  await deleteLine("offer", req, res);
});
app.delete("/api/projects/projects/:id/order/:lineId", async (req, res) => {
  await deleteLine("order", req, res);
});
app.delete("/api/projects/projects/:id/invoice/:lineId", async (req, res) => {
  await deleteLine("invoice", req, res);
});

// helpers for lines
async function updateLine(kind, req, res) {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { vendor = null, amount = null } = req.body || {};
    if (amount != null && !Number.isFinite(Number(amount))) return res.status(400).json({ error: "bad amount" });

    const tables = {
      offer: { table: "pm_offers",  dateCol: "received_at" },
      order: { table: "pm_orders",  dateCol: "ordered_at"  },
      invoice:{ table: "pm_invoices",dateCol: "invoiced_at" },
    };
    const t = tables[kind];
    if (!t) return res.status(400).json({ error: "bad kind" });

    const sql = `
      UPDATE ${t.table}
         SET vendor = COALESCE($1, vendor),
             amount = COALESCE($2, amount)
       WHERE id=$3 AND project_id=$4 AND site=$5
       RETURNING *`;
    const { rows:[row] } = await pool.query(sql, [vendor, amount != null ? num(amount) : null, lineId, id, site]);
    if (!row) return res.status(404).json({ error: "line not found" });

    await logAudit(site, id, `update_${kind}`, { line_id: lineId, vendor: row.vendor, amount: row.amount });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function deleteLine(kind, req, res) {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);

    const tables = { offer: "pm_offers", order: "pm_orders", invoice: "pm_invoices" };
    const table = tables[kind];
    if (!table) return res.status(400).json({ error: "bad kind" });

    const del = await pool.query(`DELETE FROM ${table} WHERE id=$1 AND project_id=$2 AND site=$3 RETURNING id`, [lineId, id, site]);
    if (!del.rows.length) return res.status(404).json({ error: "line not found" });

    await logAudit(site, id, `delete_${kind}`, { line_id: lineId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ===================== ANALYSIS & AI ===================== */
function analyze(fin, budget) {
  const offer = num(fin.offers_total);
  const commit = num(fin.orders_total);
  const spent = num(fin.invoices_total);
  const variance_vs_offer = offer ? spent - offer : null;
  const variance_vs_budget = budget ? spent - budget : null;
  const risk_overrun_offer = offer && spent > offer * 1.05;
  const risk_overrun_budget = budget && spent > budget * 1.05;
  const health = risk_overrun_budget ? "critical" : risk_overrun_offer ? "warn" : "ok";
  return { offer, commit, spent, variance_vs_offer, variance_vs_budget, risk_overrun_offer, risk_overrun_budget, health };
}

app.get("/api/projects/projects/:id/analysis", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const pQ = await pool.query(`SELECT * FROM pm_projects WHERE id=$1 AND site=$2`, [id, site]);
    if (!pQ.rows.length) return res.status(404).json({ error: "Not found" });
    const p = pQ.rows[0];
    const sums = (await pool.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM pm_offers  o WHERE o.project_id=$1 AND o.site=$2),0) AS offers_total,
         COALESCE((SELECT SUM(amount) FROM pm_orders  o WHERE o.project_id=$1 AND o.site=$2),0) AS orders_total,
         COALESCE((SELECT SUM(amount) FROM pm_invoices i WHERE i.project_id=$1 AND i.site=$2),0) AS invoices_total`,
      [id, site]
    )).rows[0];

    const out = analyze(sums, p.budget_amount);
    await pool.query(`UPDATE pm_status SET last_analysis = $1 WHERE project_id=$2 AND site=$3`, [out, id, site]).catch(() => {});
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/projects/projects/:id/assistant", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { question } = req.body || {};
    if (!openai) return res.json({ answer: "AI not available (missing API key)." });

    const pQ = await pool.query(`SELECT title, wbs_number, budget_amount FROM pm_projects WHERE id=$1 AND site=$2`, [id, site]);
    const sums = (await pool.query(`SELECT COALESCE(SUM(amount),0) AS offers FROM pm_offers WHERE project_id=$1 AND site=$2`, [id, site])).rows[0];

    const ctx = `Project: ${pQ.rows[0]?.title || id}
WBS: ${pQ.rows[0]?.wbs_number || '-'}
Budget: ${pQ.rows[0]?.budget_amount || '-'}
Offers: ${sums.offers}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a senior PMO/Controlling assistant. Answer concisely with actionable and quantified advice." },
        { role: "user", content: `${ctx}\nQuestion: ${question || "Provide a short-term risk analysis."}` },
      ],
    });
    const answer = completion.choices[0].message.content.trim();
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== START ===================== */
const port = process.env.PROJECTS_PORT || 3013;
app.listen(port, () => console.log(`Project Manager API listening on :${port}`));
