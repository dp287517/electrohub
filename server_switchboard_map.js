// ==============================
// server_switchboard_map.js — Switchboards MAP microservice (ESM)
// ==============================
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const PORT = Number(process.env.SWB_MAP_PORT || 3035);
const HOST = process.env.SWB_MAP_HOST || "0.0.0.0";

// Base du microservice VSD pour réutiliser les mêmes plans
const VSD_MAPS_BASE =
  process.env.VSD_MAPS_BASE || process.env.VSD_BASE_URL || "http://localhost:3020";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-User-Email",
      "X-User-Name",
      "Authorization",
      "X-Site",
      "X-Confirm",
    ],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "object-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["*"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

function getUser(req) {
  const name = req.header("X-User-Name") || null;
  const email = req.header("X-User-Email") || null;
  return { name, email };
}

// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.SWB_MAP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -------------------------------------------------
// DB schema : positions des switchboards
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS switchboard_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      switchboard_id UUID NOT NULL,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (switchboard_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_swb_pos_lookup ON switchboard_positions(logical_name, page_index);
    CREATE INDEX IF NOT EXISTS idx_swb_pos_swb ON switchboard_positions(switchboard_id);
  `);
}

// -------------------------------------------------
// Proxy helpers vers VSD
async function proxyToVsd(req, res, path, { method = "GET", body = null } = {}) {
  const url = new URL(path, VSD_MAPS_BASE);

  // Copie query params
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const headers = {
    "Content-Type": "application/json",
  };

  // Transmets identité/site si présents
  const passHeaders = ["x-user-email", "x-user-name", "x-site", "authorization"];
  passHeaders.forEach((h) => {
    const val = req.headers[h];
    if (val) headers[h] = val;
  });

  const vsdRes = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Pipe status + headers content-type/disposition
  res.status(vsdRes.status);
  const ct = vsdRes.headers.get("content-type");
  if (ct) res.set("Content-Type", ct);
  const cd = vsdRes.headers.get("content-disposition");
  if (cd) res.set("Content-Disposition", cd);

  const buf = Buffer.from(await vsdRes.arrayBuffer());
  return res.send(buf);
}

// -------------------------------------------------
// MAPS (Plans partagés avec VSD)
// -------------------------------------------------

// GET /api/switchboard/maps/listPlans
app.get("/api/switchboard/maps/listPlans", async (req, res) => {
  try {
    return proxyToVsd(req, res, "/api/vsd/maps/listPlans");
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/planFile
app.get("/api/switchboard/maps/planFile", async (req, res) => {
  try {
    return proxyToVsd(req, res, "/api/vsd/maps/planFile");
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/positions
// -> renvoie les points avec métadonnées utiles pour la map
app.get("/api/switchboard/maps/positions", async (req, res) => {
  try {
    const { logical_name, id, page_index = 0 } = req.query;
    if (!logical_name && !id) {
      return res
        .status(400)
        .json({ ok: false, error: "logical_name or id required" });
    }

    // Si id plan fourni, on demande au VSD le logical_name
    let planKey = logical_name;
    if (id) {
      const vsdUrl = new URL("/api/vsd/maps/listPlans", VSD_MAPS_BASE);
      const vsdRes = await fetch(vsdUrl.toString(), { method: "GET" });
      const data = await vsdRes.json().catch(() => ({}));
      const found = (data.plans || []).find((p) => p.id === id);
      if (found) planKey = found.logical_name;
    }
    if (!planKey) {
      return res.status(404).json({ ok: false, error: "Plan not found" });
    }

    const { rows } = await pool.query(
      `
        SELECT
          pos.switchboard_id,
          pos.x_frac,
          pos.y_frac,
          pos.page_index,
          pos.logical_name
        FROM switchboard_positions pos
        WHERE pos.logical_name=$1 AND pos.page_index=$2
      `,
      [String(planKey), Number(page_index)]
    );

    res.json({ ok: true, positions: rows, logical_name: planKey });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/switchboard/maps/setPosition
app.post("/api/switchboard/maps/setPosition", async (req, res) => {
  try {
    const u = getUser(req);
    const {
      switchboard_id,
      logical_name,
      plan_id = null,
      page_index = 0,
      x_frac,
      y_frac,
    } = req.body || {};

    if (!switchboard_id || !logical_name || x_frac == null || y_frac == null) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    await pool.query(
      `
      INSERT INTO switchboard_positions
        (switchboard_id, logical_name, plan_id, page_index, x_frac, y_frac)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(switchboard_id, logical_name, page_index)
      DO UPDATE SET
        x_frac=EXCLUDED.x_frac,
        y_frac=EXCLUDED.y_frac,
        plan_id=EXCLUDED.plan_id
      `,
      [
        String(switchboard_id),
        String(logical_name),
        plan_id ? String(plan_id) : null,
        Number(page_index),
        Number(x_frac),
        Number(y_frac),
      ]
    );

    // log soft (pas de table events ici pour rester léger)
    console.log("[swb-map] position set", {
      switchboard_id,
      logical_name,
      page_index,
      by: u.email || u.name || "unknown",
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/missing
// -> liste des IDs de switchboards sans position
app.get("/api/switchboard/maps/missing", async (_req, res) => {
  try {
    // Comme on ne veut pas lier au service switchboard ici,
    // on expose juste ce qu’on sait : la liste des switchboards qui ONT une position.
    const { rows } = await pool.query(
      `SELECT DISTINCT switchboard_id FROM switchboard_positions`
    );
    res.json({ ok: true, placed_ids: rows.map((r) => r.switchboard_id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[switchboard-map] listening on ${HOST}:${PORT}`);
});
