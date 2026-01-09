// server_switchboard_map.js — Switchboards MAP microservice (ESM)
// VERSION 3.0 - ROBUSTE TIMEOUTS & PERFORMANCE
// Partage les plans PDF avec VSD, gère les positions des tableaux électriques
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import pg from "pg";
import { getSiteFilter } from "./lib/tenant-filter.js";

dotenv.config();

const PORT = Number(process.env.SWB_MAP_PORT || 3035);
const HOST = process.env.SWB_MAP_HOST || "0.0.0.0";

// Base du microservice VSD pour réutiliser les mêmes plans
const VSD_MAPS_BASE = process.env.VSD_MAPS_BASE || process.env.VSD_BASE_URL || "http://localhost:3020";

// Base du microservice Switchboard pour récupérer les infos des tableaux
const SWITCHBOARD_BASE = process.env.SWITCHBOARD_BASE || "http://localhost:3003";

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
        "media-src": ["'self'", "data:", "blob:"],
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

function getSite(req) {
  return req.header("X-Site") || req.query.site || "Default";
}

// -------------------------------------------------
// POOL CONFIGURATION - VERSION 3.0 ROBUSTE
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.SWB_MAP_DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 15,                          // Augmenté de 10 à 15
  min: 1,                           // Garde 1 connexion chaude minimum
  idleTimeoutMillis: 60000,         // 60s avant de fermer une connexion idle
  connectionTimeoutMillis: 8000,    // 8s max pour acquérir une connexion
  allowExitOnIdle: false,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// Pool error handling
pool.on('error', (err) => {
  console.error('[SWB-MAP POOL] Unexpected error:', err.message);
});

// Pool stats
let poolStats = { queries: 0, errors: 0, timeouts: 0 };

// ✅ HELPER: Acquérir une connexion avec timeout strict
async function acquireConnection(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      poolStats.timeouts++;
      reject(new Error(`Connection acquire timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    pool.connect()
      .then(client => {
        clearTimeout(timeoutId);
        resolve(client);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

// ✅ HELPER: Query avec timeout robuste
async function quickQuery(sql, params = [], timeoutMs = 10000) {
  poolStats.queries++;
  let client;
  try {
    client = await acquireConnection(5000);
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(sql, params);
    return result;
  } catch (err) {
    poolStats.errors++;
    throw err;
  } finally {
    if (client) {
      try { client.release(); } catch (e) { /* ignore */ }
    }
  }
}

// ✅ KEEPALIVE pour éviter les cold starts Neon
let keepaliveInterval = null;
function startKeepalive() {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(async () => {
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      console.warn('[SWB-MAP KEEPALIVE] Ping failed:', e.message);
    }
  }, 4 * 60 * 1000);
  console.log('[SWB-MAP] Keepalive started (4min interval)');
}

// -------------------------------------------------
// DB schema : positions des switchboards sur les plans
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS switchboard_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT NOT NULL DEFAULT 'Default',
      switchboard_id INTEGER NOT NULL,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (site, switchboard_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_swb_pos_lookup ON switchboard_positions(site, logical_name, page_index);
    CREATE INDEX IF NOT EXISTS idx_swb_pos_swb ON switchboard_positions(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_swb_pos_site ON switchboard_positions(site);
  `);

  // Migration: ajouter colonne site si elle n'existe pas
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='switchboard_positions' AND column_name='site') THEN
        ALTER TABLE switchboard_positions ADD COLUMN site TEXT NOT NULL DEFAULT 'Default';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='switchboard_positions' AND column_name='created_at') THEN
        ALTER TABLE switchboard_positions ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='switchboard_positions' AND column_name='updated_at') THEN
        ALTER TABLE switchboard_positions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
      END IF;
    END $$;
  `);

  // Trigger pour updated_at
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_swb_pos_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_swb_pos_updated_at') THEN
        CREATE TRIGGER trg_swb_pos_updated_at
        BEFORE UPDATE ON switchboard_positions
        FOR EACH ROW EXECUTE FUNCTION update_swb_pos_updated_at();
      END IF;
    END $$;
  `);

  // Table pour stocker l'historique des événements (optionnel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS switchboard_map_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMPTZ DEFAULT NOW(),
      site TEXT,
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_swb_map_events_ts ON switchboard_map_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_swb_map_events_site ON switchboard_map_events(site);
  `);
}

// -------------------------------------------------
// Helpers

async function logEvent(site, action, details = {}, user = {}) {
  try {
    await pool.query(
      `INSERT INTO switchboard_map_events(site, action, details, actor_name, actor_email) 
       VALUES($1, $2, $3, $4, $5)`,
      [site, action, details, user.name || null, user.email || null]
    );
  } catch (e) {
    console.warn("[swb-map] Log event error:", e.message);
  }
}

// Proxy helpers vers VSD pour les plans
async function proxyToVsd(req, res, path, { method = "GET", body = null } = {}) {
  const url = new URL(path, VSD_MAPS_BASE);

  // Copie query params
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
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

  try {
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
    const cc = vsdRes.headers.get("cache-control");
    if (cc) res.set("Cache-Control", cc);

    const buf = Buffer.from(await vsdRes.arrayBuffer());
    return res.send(buf);
  } catch (e) {
    console.error("[swb-map] Proxy to VSD error:", e.message);
    return res.status(502).json({ ok: false, error: "VSD service unavailable: " + e.message });
  }
}

// Récupérer les infos d'un switchboard depuis le service principal
async function getSwitchboardInfo(switchboardId, site, headers = {}) {
  try {
    const url = `${SWITCHBOARD_BASE}/api/switchboard/boards/${switchboardId}?site=${encodeURIComponent(site)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Site": site,
        ...headers,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[swb-map] Get switchboard info error:", e.message);
    return null;
  }
}

// Récupérer tous les switchboards d'un site
async function getAllSwitchboards(site, headers = {}) {
  try {
    const url = `${SWITCHBOARD_BASE}/api/switchboard/boards?site=${encodeURIComponent(site)}&pageSize=500`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Site": site,
        ...headers,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.warn("[swb-map] Get all switchboards error:", e.message);
    return [];
  }
}

// -------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------

app.get("/api/switchboard/maps/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, ts: Date.now(), service: "switchboard-map" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// PLANS (Partagés avec VSD - Proxy)
// -------------------------------------------------

// GET /api/switchboard/maps/listPlans - Liste tous les plans PDF
app.get("/api/switchboard/maps/listPlans", async (req, res) => {
  try {
    return proxyToVsd(req, res, "/api/vsd/maps/listPlans");
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/planFile - Récupérer le fichier PDF d'un plan
app.get("/api/switchboard/maps/planFile", async (req, res) => {
  try {
    return proxyToVsd(req, res, "/api/vsd/maps/planFile");
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/switchboard/maps/renamePlan - Renommer un plan (proxy)
app.put("/api/switchboard/maps/renamePlan", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const { logical_name, display_name } = req.body || {};
    
    if (!logical_name) {
      return res.status(400).json({ ok: false, error: "logical_name required" });
    }

    // Proxy vers VSD
    const url = new URL("/api/vsd/maps/renamePlan", VSD_MAPS_BASE);
    const vsdRes = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Site": site,
        "X-User-Email": u.email || "",
        "X-User-Name": u.name || "",
      },
      body: JSON.stringify({ logical_name, display_name }),
    });

    const data = await vsdRes.json().catch(() => ({}));
    
    if (vsdRes.ok) {
      await logEvent(site, "plan_renamed", { logical_name, display_name }, u);
    }

    res.status(vsdRes.status).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// POSITIONS DES SWITCHBOARDS
// -------------------------------------------------

// GET /api/switchboard/maps/positions - Récupérer les positions sur un plan
app.get("/api/switchboard/maps/positions", async (req, res) => {
  try {
    const site = getSite(req);
    const { logical_name, id, page_index = 0 } = req.query;
    
    if (!logical_name && !id) {
      return res.status(400).json({ ok: false, error: "logical_name or id required" });
    }

    // Si id plan fourni, on demande au VSD le logical_name
    let planKey = logical_name;
    if (id && !logical_name) {
      try {
        const vsdUrl = new URL("/api/vsd/maps/listPlans", VSD_MAPS_BASE);
        const vsdRes = await fetch(vsdUrl.toString(), { 
          method: "GET",
          headers: { "X-Site": site }
        });
        const data = await vsdRes.json().catch(() => ({}));
        const found = (data.plans || []).find((p) => p.id === id);
        if (found) planKey = found.logical_name;
      } catch (e) {
        console.warn("[swb-map] VSD plans lookup error:", e.message);
      }
    }
    
    if (!planKey) {
      return res.status(404).json({ ok: false, error: "Plan not found" });
    }

    // Récupérer les positions depuis notre table
    const { rows } = await pool.query(
      `SELECT 
        pos.id,
        pos.switchboard_id,
        pos.x_frac,
        pos.y_frac,
        pos.page_index,
        pos.logical_name,
        pos.plan_id,
        pos.created_at,
        pos.updated_at
       FROM switchboard_positions pos
       WHERE pos.site = $1 AND pos.logical_name = $2 AND pos.page_index = $3
       ORDER BY pos.created_at ASC`,
      [site, String(planKey), Number(page_index)]
    );

    // Enrichir avec les infos des switchboards
    const switchboardIds = [...new Set(rows.map(r => r.switchboard_id))];
    const switchboardsMap = new Map();

    // Récupérer les infos de tous les switchboards en une fois
    if (switchboardIds.length > 0) {
      const allSwitchboards = await getAllSwitchboards(site, {
        "X-User-Email": req.header("X-User-Email") || "",
        "X-User-Name": req.header("X-User-Name") || "",
      });

      // Debug: log switchboards with categories
      const withCategories = allSwitchboards.filter(sb => sb.category_id);
      console.log('[swb-map] Switchboards with categories:', withCategories.length, 'of', allSwitchboards.length);
      if (withCategories.length > 0) {
        console.log('[swb-map] Example with category:', {
          id: withCategories[0].id,
          name: withCategories[0].name,
          category_id: withCategories[0].category_id,
          category_name: withCategories[0].category_name,
          category_color: withCategories[0].category_color
        });
      }

      allSwitchboards.forEach(sb => {
        switchboardsMap.set(sb.id, sb);
      });
    }

    // Construire la réponse enrichie
    const positions = rows.map(pos => {
      const sb = switchboardsMap.get(pos.switchboard_id);
      return {
        id: pos.id,
        switchboard_id: pos.switchboard_id,
        x_frac: Number(pos.x_frac),
        y_frac: Number(pos.y_frac),
        x: Number(pos.x_frac),
        y: Number(pos.y_frac),
        page_index: pos.page_index,
        logical_name: pos.logical_name,
        // Infos du switchboard
        name: sb?.name || `Tableau #${pos.switchboard_id}`,
        code: sb?.code || "",
        building: sb?.meta?.building_code || "",
        floor: sb?.meta?.floor || "",
        room: sb?.meta?.room || "",
        is_principal: sb?.is_principal || false,
        regime_neutral: sb?.regime_neutral || "",
        // Category info
        category_id: sb?.category_id || null,
        category_name: sb?.category_name || "",
        category_color: sb?.category_color || "",
      };
    });

    res.json({ ok: true, positions, logical_name: planKey, page_index: Number(page_index) });
  } catch (e) {
    console.error("[swb-map] Get positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/switchboard/maps/setPosition - Placer ou déplacer un switchboard
// This ensures switchboard is only on ONE plan at a time (deletes ALL old positions first)
app.post("/api/switchboard/maps/setPosition", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const {
      switchboard_id,
      logical_name,
      plan_id = null,
      page_index = 0,
      x_frac,
      y_frac,
    } = req.body || {};

    if (!switchboard_id || !logical_name || x_frac == null || y_frac == null) {
      return res.status(400).json({ ok: false, error: "Missing required fields: switchboard_id, logical_name, x_frac, y_frac" });
    }

    // Valider les coordonnées
    const xVal = Number(x_frac);
    const yVal = Number(y_frac);
    if (isNaN(xVal) || isNaN(yVal) || xVal < 0 || xVal > 1 || yVal < 0 || yVal > 1) {
      return res.status(400).json({ ok: false, error: "x_frac and y_frac must be numbers between 0 and 1" });
    }

    // Vérifier que le switchboard existe
    const sbInfo = await getSwitchboardInfo(switchboard_id, site, {
      "X-User-Email": u.email || "",
      "X-User-Name": u.name || "",
    });

    // CRITICAL: Delete ALL existing positions for this switchboard (across ALL sites/plans)
    // This ensures the switchboard is NEVER on multiple plans
    const deleteResult = await pool.query(
      `DELETE FROM switchboard_positions WHERE switchboard_id = $1`,
      [Number(switchboard_id)]
    );
    console.log(`[swb-map] Deleted ${deleteResult.rowCount} old positions for switchboard ${switchboard_id}`);

    // Then insert the new position
    const { rows } = await pool.query(
      `INSERT INTO switchboard_positions
        (site, switchboard_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        site,
        Number(switchboard_id),
        String(logical_name),
        plan_id ? String(plan_id) : null,
        Number(page_index),
        xVal,
        yVal,
      ]
    );

    await logEvent(site, "position_set", {
      switchboard_id,
      switchboard_name: sbInfo?.name || sbInfo?.code,
      logical_name,
      page_index,
      x_frac: xVal,
      y_frac: yVal,
    }, u);

    console.log("[swb-map] Position set:", {
      switchboard_id,
      logical_name,
      page_index,
      x_frac: xVal,
      y_frac: yVal,
      by: u.email || u.name || "unknown",
    });

    res.json({
      ok: true,
      position: rows[0],
      switchboard: sbInfo || { id: switchboard_id }
    });
  } catch (e) {
    console.error("[swb-map] Set position error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cleanup duplicate positions - keeps only the most recent position per switchboard
app.post("/api/switchboard/maps/cleanup-duplicates", async (req, res) => {
  try {
    const site = getSite(req);

    // Find switchboards with multiple positions
    const { rows: duplicates } = await pool.query(`
      SELECT switchboard_id, COUNT(*) as count
      FROM switchboard_positions
      ${site ? 'WHERE site = $1' : ''}
      GROUP BY switchboard_id
      HAVING COUNT(*) > 1
    `, site ? [site] : []);

    console.log(`[swb-map] Found ${duplicates.length} switchboards with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      // Keep only the most recent position (by created_at or updated_at)
      const result = await pool.query(`
        DELETE FROM switchboard_positions
        WHERE switchboard_id = $1
        AND id NOT IN (
          SELECT id FROM switchboard_positions
          WHERE switchboard_id = $1
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT 1
        )
      `, [dup.switchboard_id]);
      totalRemoved += result.rowCount;
      console.log(`[swb-map] Switchboard ${dup.switchboard_id}: removed ${result.rowCount} duplicate positions`);
    }

    res.json({
      ok: true,
      duplicates_found: duplicates.length,
      positions_removed: totalRemoved
    });
  } catch (e) {
    console.error("[swb-map] Cleanup error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🧹 POST /api/switchboard/maps/cleanup-orphans - Nettoyer les positions orphelines (switchboards supprimés)
app.post("/api/switchboard/maps/cleanup-orphans", async (req, res) => {
  try {
    const site = getSite(req);
    console.log(`[swb-map] Cleaning up orphaned positions for site: ${site}`);

    // Delete positions where the switchboard no longer exists
    const result = await pool.query(`
      DELETE FROM switchboard_positions sp
      WHERE site = $1
      AND NOT EXISTS (SELECT 1 FROM switchboards s WHERE s.id = sp.switchboard_id AND s.site = sp.site)
      RETURNING *
    `, [site]);

    console.log(`[swb-map] Cleaned up ${result.rowCount} orphaned positions`);
    res.json({
      ok: true,
      deletedCount: result.rowCount,
      deleted: result.rows.map(p => ({ id: p.id, switchboard_id: p.switchboard_id, logical_name: p.logical_name }))
    });
  } catch (e) {
    console.error("[swb-map] Cleanup orphans error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/switchboard/maps/positions/:id - Supprimer une position
app.delete("/api/switchboard/maps/positions/:id", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const positionId = req.params.id;

    // Récupérer d'abord pour le log
    const { rows: existing } = await pool.query(
      `SELECT * FROM switchboard_positions WHERE id = $1 AND site = $2`,
      [positionId, site]
    );

    if (!existing.length) {
      return res.status(404).json({ ok: false, error: "Position not found" });
    }

    await pool.query(
      `DELETE FROM switchboard_positions WHERE id = $1 AND site = $2`,
      [positionId, site]
    );

    await logEvent(site, "position_deleted", { 
      position_id: positionId,
      switchboard_id: existing[0].switchboard_id,
      logical_name: existing[0].logical_name,
    }, u);

    res.json({ ok: true, deleted: positionId });
  } catch (e) {
    console.error("[swb-map] Delete position error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/switchboard/maps/positions/switchboard/:switchboardId - Supprimer toutes les positions d'un switchboard
app.delete("/api/switchboard/maps/positions/switchboard/:switchboardId", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const switchboardId = Number(req.params.switchboardId);

    const result = await pool.query(
      `DELETE FROM switchboard_positions WHERE switchboard_id = $1 AND site = $2 RETURNING id`,
      [switchboardId, site]
    );

    await logEvent(site, "positions_cleared", { 
      switchboard_id: switchboardId,
      count: result.rowCount,
    }, u);

    res.json({ ok: true, deleted_count: result.rowCount });
  } catch (e) {
    console.error("[swb-map] Delete switchboard positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// STATISTIQUES ET LISTES UTILES
// -------------------------------------------------

// GET /api/switchboard/maps/placed - Liste des switchboards placés sur au moins un plan
app.get("/api/switchboard/maps/placed", async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req);
    const site = siteName || getSite(req);
    if (role === 'site' && !site) return res.status(400).json({ ok: false, error: 'Missing site' });

    const { rows } = await pool.query(
      `SELECT DISTINCT switchboard_id,
              COUNT(*) as position_count,
              array_agg(DISTINCT logical_name) as plans
       FROM switchboard_positions
       WHERE ${siteWhere}
       GROUP BY switchboard_id`,
      siteParams
    );

    const placedIds = rows.map(r => r.switchboard_id);
    const placedMap = {};
    rows.forEach(r => {
      placedMap[r.switchboard_id] = {
        position_count: Number(r.position_count),
        plans: r.plans || [],
      };
    });

    res.json({ ok: true, placed_ids: placedIds, placed_details: placedMap });
  } catch (e) {
    console.error("[swb-map] Get placed error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/unplaced - Liste des switchboards NON placés
app.get("/api/switchboard/maps/unplaced", async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req);
    const site = siteName || getSite(req);
    if (role === 'site' && !site) return res.status(400).json({ ok: false, error: 'Missing site' });
    const u = getUser(req);

    // Récupérer tous les switchboards
    const allSwitchboards = await getAllSwitchboards(site, {
      "X-User-Email": u.email || "",
      "X-User-Name": u.name || "",
    });

    // Récupérer les IDs des switchboards placés
    const { rows } = await pool.query(
      `SELECT DISTINCT switchboard_id FROM switchboard_positions WHERE ${siteWhere}`,
      siteParams
    );
    const placedIds = new Set(rows.map(r => r.switchboard_id));

    // Filtrer les non placés
    const unplaced = allSwitchboards.filter(sb => !placedIds.has(sb.id));

    res.json({ 
      ok: true, 
      unplaced,
      total_switchboards: allSwitchboards.length,
      placed_count: placedIds.size,
      unplaced_count: unplaced.length,
    });
  } catch (e) {
    console.error("[swb-map] Get unplaced error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/stats - Statistiques globales
app.get("/api/switchboard/maps/stats", async (req, res) => {
  try {
    const site = getSite(req);
    const u = getUser(req);

    // Stats des positions
    const { rows: posStats } = await pool.query(
      `SELECT 
        COUNT(DISTINCT switchboard_id) as placed_switchboards,
        COUNT(*) as total_positions,
        COUNT(DISTINCT logical_name) as plans_used
       FROM switchboard_positions 
       WHERE site = $1`,
      [site]
    );

    // Total des switchboards
    const allSwitchboards = await getAllSwitchboards(site, {
      "X-User-Email": u.email || "",
      "X-User-Name": u.name || "",
    });

    const stats = posStats[0] || { placed_switchboards: 0, total_positions: 0, plans_used: 0 };

    res.json({ 
      ok: true, 
      stats: {
        total_switchboards: allSwitchboards.length,
        placed_switchboards: Number(stats.placed_switchboards),
        unplaced_switchboards: allSwitchboards.length - Number(stats.placed_switchboards),
        total_positions: Number(stats.total_positions),
        plans_used: Number(stats.plans_used),
        placement_rate: allSwitchboards.length > 0 
          ? Math.round((Number(stats.placed_switchboards) / allSwitchboards.length) * 100) 
          : 0,
      }
    });
  } catch (e) {
    console.error("[swb-map] Get stats error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/switchboard/maps/plan/:logicalName/stats - Stats d'un plan spécifique
app.get("/api/switchboard/maps/plan/:logicalName/stats", async (req, res) => {
  try {
    const site = getSite(req);
    const logicalName = req.params.logicalName;

    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as switchboard_count,
        COUNT(DISTINCT page_index) as pages_used
       FROM switchboard_positions 
       WHERE site = $1 AND logical_name = $2`,
      [site, logicalName]
    );

    const stats = rows[0] || { switchboard_count: 0, pages_used: 0 };

    res.json({ 
      ok: true, 
      logical_name: logicalName,
      stats: {
        switchboard_count: Number(stats.switchboard_count),
        pages_used: Number(stats.pages_used),
      }
    });
  } catch (e) {
    console.error("[swb-map] Get plan stats error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// ÉVÉNEMENTS / HISTORIQUE
// -------------------------------------------------

// GET /api/switchboard/maps/events - Historique des événements
app.get("/api/switchboard/maps/events", async (req, res) => {
  try {
    const site = getSite(req);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const { rows } = await pool.query(
      `SELECT * FROM switchboard_map_events 
       WHERE site = $1 
       ORDER BY ts DESC 
       LIMIT $2`,
      [site, limit]
    );

    res.json({ ok: true, events: rows });
  } catch (e) {
    console.error("[swb-map] Get events error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// BULK OPERATIONS
// -------------------------------------------------

// POST /api/switchboard/maps/bulk/setPositions - Placer plusieurs switchboards d'un coup
app.post("/api/switchboard/maps/bulk/setPositions", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const { positions } = req.body || {};

    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ ok: false, error: "positions array required" });
    }

    const results = [];
    const errors = [];

    for (const pos of positions) {
      try {
        const { switchboard_id, logical_name, plan_id, page_index = 0, x_frac, y_frac } = pos;
        
        if (!switchboard_id || !logical_name || x_frac == null || y_frac == null) {
          errors.push({ switchboard_id, error: "Missing required fields" });
          continue;
        }

        const xVal = Number(x_frac);
        const yVal = Number(y_frac);
        
        if (isNaN(xVal) || isNaN(yVal) || xVal < 0 || xVal > 1 || yVal < 0 || yVal > 1) {
          errors.push({ switchboard_id, error: "Invalid coordinates" });
          continue;
        }

        const { rows } = await pool.query(
          `INSERT INTO switchboard_positions
            (site, switchboard_id, logical_name, plan_id, page_index, x_frac, y_frac)
           VALUES($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT(site, switchboard_id, logical_name, page_index)
           DO UPDATE SET
             x_frac = EXCLUDED.x_frac,
             y_frac = EXCLUDED.y_frac,
             plan_id = EXCLUDED.plan_id,
             updated_at = NOW()
           RETURNING id`,
          [site, Number(switchboard_id), String(logical_name), plan_id || null, Number(page_index), xVal, yVal]
        );

        results.push({ switchboard_id, position_id: rows[0]?.id, success: true });
      } catch (err) {
        errors.push({ switchboard_id: pos.switchboard_id, error: err.message });
      }
    }

    await logEvent(site, "bulk_positions_set", { 
      count: results.length,
      errors: errors.length,
    }, u);

    res.json({ 
      ok: true, 
      results, 
      errors,
      summary: {
        total: positions.length,
        success: results.length,
        failed: errors.length,
      }
    });
  } catch (e) {
    console.error("[swb-map] Bulk set positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/switchboard/maps/bulk/clearPlan - Supprimer toutes les positions d'un plan
app.delete("/api/switchboard/maps/bulk/clearPlan", async (req, res) => {
  try {
    const u = getUser(req);
    const site = getSite(req);
    const { logical_name, page_index } = req.query;

    if (!logical_name) {
      return res.status(400).json({ ok: false, error: "logical_name required" });
    }

    let query = `DELETE FROM switchboard_positions WHERE site = $1 AND logical_name = $2`;
    const params = [site, logical_name];

    if (page_index !== undefined) {
      query += ` AND page_index = $3`;
      params.push(Number(page_index));
    }

    query += ` RETURNING id`;

    const result = await pool.query(query, params);

    await logEvent(site, "plan_positions_cleared", { 
      logical_name,
      page_index: page_index !== undefined ? Number(page_index) : "all",
      count: result.rowCount,
    }, u);

    res.json({ ok: true, deleted_count: result.rowCount });
  } catch (e) {
    console.error("[swb-map] Clear plan positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// COMPATIBILITY ENDPOINTS (pour api.js existant)
// -------------------------------------------------

// Alias: GET /api/switchboard/maps/missing -> placed_ids (compatibilité)
// Also returns placed_details for navigation from sidebar
app.get("/api/switchboard/maps/missing", async (req, res) => {
  try {
    const site = getSite(req);

    const { rows } = await pool.query(
      `SELECT switchboard_id, 
              COUNT(*) as position_count,
              array_agg(DISTINCT logical_name) as plans
       FROM switchboard_positions 
       WHERE site = $1
       GROUP BY switchboard_id`,
      [site]
    );

    const placedIds = rows.map(r => r.switchboard_id);
    const placedDetails = {};
    rows.forEach(r => {
      placedDetails[r.switchboard_id] = {
        position_count: Number(r.position_count),
        plans: r.plans || [],
      };
    });

    res.json({ ok: true, placed_ids: placedIds, placed_details: placedDetails });
  } catch (e) {
    console.error("[swb-map] Get missing (compat) error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Alias explicite : /api/switchboard-map/placed-ids (utilisé par certains fronts)
app.get("/api/switchboard-map/placed-ids", async (req, res) => {
  try {
    const site = getSite(req);

    const { rows } = await pool.query(
      `SELECT switchboard_id,
              COUNT(*) as position_count,
              array_agg(DISTINCT logical_name) as plans
       FROM switchboard_positions
       WHERE site = $1
       GROUP BY switchboard_id`,
      [site]
    );

    const placedIds = rows.map((r) => Number(r.switchboard_id));
    const placedDetails = {};
    rows.forEach((r) => {
      placedDetails[r.switchboard_id] = {
        position_count: Number(r.position_count),
        plans: r.plans || [],
      };
    });

    res.json({ ok: true, placed_ids: placedIds, placed_details: placedDetails });
  } catch (e) {
    console.error("[swb-map] Get placed-ids alias error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// Initialisation et démarrage
// -------------------------------------------------

await ensureSchema();

// ✅ Export pour que server_switchboard.js puisse monter ces routes
export default app;

// ✅ On ne démarre ce microservice SEUL que si on le demande explicitement
if (process.env.START_SWB_MAP === "true") {
  app.listen(PORT, HOST, () => {
    console.log(`[switchboard-map] v3.0 listening on ${HOST}:${PORT}`);
    console.log(`[switchboard-map] VSD proxy: ${VSD_MAPS_BASE}`);
    console.log(`[switchboard-map] Switchboard service: ${SWITCHBOARD_BASE}`);

    // ✅ Démarrer le keepalive pour éviter les cold starts Neon
    startKeepalive();

    // ✅ Warm up DB connection
    pool.query('SELECT 1').then(() => {
      console.log('[switchboard-map] Database connection warmed up');
    }).catch(e => {
      console.warn('[switchboard-map] Database warmup failed:', e.message);
    });
  });
}
