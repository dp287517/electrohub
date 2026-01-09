// server_switchboard.js - Backend complet Switchboard
// VERSION 3.1 - ROBUSTE TIMEOUTS & PERFORMANCE + AUDIT TRAIL
// =======================================================
//
// CHANGEMENTS v3.1:
// - Ajout audit trail pour traçabilité des modifications
// - Support multi-tenant (company_id/site_id)
//
// CHANGEMENTS v3.0:
// 1. Timeout sur l'ACQUISITION de connexion (pas seulement sur la query)
// 2. Pool plus grand (20 connexions) avec monitoring avancé
// 3. Keepalive automatique pour éviter les cold starts Neon
// 4. Retry automatique avec exponential backoff
// 5. Protection contre les requêtes qui bloquent
// 6. Logs détaillés pour debugging
//
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { createAuditTrail, AUDIT_ACTIONS } from './lib/audit-trail.js';
import { extractTenantFromRequest, getTenantFilter } from './lib/tenant-filter.js';
import { notifyEquipmentCreated, notifyEquipmentDeleted, notifyMaintenanceCompleted, notify } from './lib/push-notify.js';

dotenv.config();
const { Pool } = pg;

// ============================================================
// UTILITY: Normalize breaker reference for consistent matching
// Used for cache lookup and unique constraint
// ============================================================
const normalizeRef = (ref) => {
  if (!ref) return '';
  return ref.toLowerCase()
    .replace(/\s+/g, '')           // Remove spaces
    .replace(/[^a-z0-9]/g, '');    // Keep only alphanumeric
};

// ============================================================
// POOL CONFIGURATION - OPTIMISÉ POUR NEON (SERVERLESS)
// VERSION 3.0 - Plus robuste avec plus de connexions
// ============================================================
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  max: 20,                          // Augmenté de 10 à 20
  min: 2,                           // Garde 2 connexions chaudes minimum
  idleTimeoutMillis: 60000,         // 60s avant de fermer une connexion idle
  connectionTimeoutMillis: 8000,    // 8s max pour acquérir une connexion
  allowExitOnIdle: false,           // Ne pas quitter si idle
  // Configuration SSL pour Neon
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Pool error handling amélioré
pool.on('error', (err) => {
  console.error('[POOL] Unexpected error on idle client:', err.message);
  poolStats.poolErrors++;
});

pool.on('connect', () => {
  poolStats.connections++;
});

// Pool monitoring avancé
let poolStats = {
  queries: 0,
  errors: 0,
  slowQueries: 0,
  timeouts: 0,
  poolErrors: 0,
  connections: 0,
  acquireTimeouts: 0,
  retries: 0
};

// ============================================================
// KEEPALIVE - Empêche les cold starts Neon (ping toutes les 4 min)
// ============================================================
let keepaliveInterval = null;
let selfPingInterval = null;

function startKeepalive() {
  if (keepaliveInterval) return;

  keepaliveInterval = setInterval(async () => {
    try {
      const start = Date.now();
      await pool.query('SELECT 1');
      const elapsed = Date.now() - start;
      if (elapsed > 500) {
        console.log(`[KEEPALIVE] Ping took ${elapsed}ms (cold start likely)`);
      }
    } catch (e) {
      console.warn('[KEEPALIVE] Ping failed:', e.message);
    }
  }, 4 * 60 * 1000); // Toutes les 4 minutes

  console.log('[SWITCHBOARD] Keepalive started (4min interval)');
}

// ============================================================
// SELF-PING: Keep server awake during active scans
// Render free tier sleeps after 15min of inactivity
// ============================================================
function startSelfPing() {
  if (selfPingInterval) return;

  const port = process.env.SWITCHBOARD_PORT || 3003;
  const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

  selfPingInterval = setInterval(async () => {
    // Count active jobs
    let activeJobs = 0;
    for (const [, job] of panelScanJobs) {
      if (job.status === 'pending' || job.status === 'analyzing') {
        activeJobs++;
      }
    }

    // Only ping if there are active jobs
    if (activeJobs > 0) {
      try {
        const response = await fetch(`${selfUrl}/api/switchboard/health`);
        if (response.ok) {
          console.log(`[SELF-PING] Server kept awake (${activeJobs} active job(s))`);
        }
      } catch (e) {
        // Ignore errors - might be localhost in dev
      }
    }
  }, 30 * 1000); // Every 30 seconds

  console.log('[SWITCHBOARD] Self-ping started (30s interval when jobs active)');
}

function stopSelfPing() {
  if (selfPingInterval) {
    clearInterval(selfPingInterval);
    selfPingInterval = null;
  }
}

// ============================================================
// HELPER: Acquérir une connexion avec timeout STRICT
// ============================================================
async function acquireConnection(timeoutMs = 8000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      poolStats.acquireTimeouts++;
      reject(new Error(`Connection acquire timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    pool.connect()
      .then(client => {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          console.warn(`[POOL] Slow connection acquire: ${elapsed}ms`);
        }
        resolve(client);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

// ============================================================
// QUERY HELPER - AVEC TIMEOUT COMPLET (acquire + query)
// ============================================================
async function query(sql, params = [], options = {}) {
  const startTime = Date.now();
  const label = options.label || 'QUERY';
  const queryTimeoutMs = options.timeout || 15000;
  const acquireTimeoutMs = options.acquireTimeout || 5000;

  poolStats.queries++;

  let client;
  try {
    // ✅ TIMEOUT sur l'acquisition de connexion
    client = await acquireConnection(acquireTimeoutMs);

    // ✅ TIMEOUT sur la requête SQL
    await client.query(`SET statement_timeout = ${queryTimeoutMs}`);
    const result = await client.query(sql, params);

    const elapsed = Date.now() - startTime;
    if (elapsed > 2000) {
      poolStats.slowQueries++;
      console.warn(`[${label}] Slow query: ${elapsed}ms`);
    }

    return result;
  } catch (err) {
    poolStats.errors++;
    const elapsed = Date.now() - startTime;

    if (err.message.includes('timeout') || err.message.includes('canceling')) {
      poolStats.timeouts++;
      console.error(`[${label}] TIMEOUT after ${elapsed}ms:`, err.message);
    } else {
      console.error(`[${label}] Error after ${elapsed}ms:`, err.message);
    }
    throw err;
  } finally {
    if (client) {
      try { client.release(); } catch (e) { /* ignore */ }
    }
  }
}

// ============================================================
// QUICK QUERY - Optimisé pour requêtes simples avec retry
// ============================================================
async function quickQuery(sql, params = [], timeoutMs = 15000, retries = 1) {
  const startTime = Date.now();
  poolStats.queries++;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let client;
    try {
      // ✅ TIMEOUT sur l'acquisition (5s max)
      client = await acquireConnection(5000);

      // ✅ TIMEOUT sur la requête SQL
      await client.query(`SET statement_timeout = ${timeoutMs}`);
      const result = await client.query(sql, params);

      const elapsed = Date.now() - startTime;
      if (elapsed > 1000) {
        poolStats.slowQueries++;
        console.warn(`[QUICK] Slow query: ${elapsed}ms - ${sql.substring(0, 50)}...`);
      }

      return result;
    } catch (err) {
      lastError = err;

      if (client) {
        try { client.release(); } catch (e) { /* ignore */ }
        client = null;
      }

      // Retry seulement si c'est un timeout d'acquisition ou une erreur transitoire
      const isRetryable = err.message.includes('Connection acquire timeout') ||
                          err.message.includes('Connection terminated') ||
                          err.message.includes('ECONNRESET');

      if (attempt < retries && isRetryable) {
        poolStats.retries++;
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000); // Exponential backoff: 1s, 2s, 4s
        console.warn(`[QUICK] Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      poolStats.errors++;
      const elapsed = Date.now() - startTime;

      if (err.message.includes('timeout') || err.message.includes('canceling')) {
        poolStats.timeouts++;
      }

      console.error(`[QUICK] Error after ${elapsed}ms:`, err.message);
      throw err;
    } finally {
      if (client) {
        try { client.release(); } catch (e) { /* ignore */ }
      }
    }
  }

  throw lastError;
}

// ============================================================
// AI SETUP (OpenAI + Gemini fallback)
// ============================================================
import { GoogleGenerativeAI } from '@google/generative-ai';

let openai = null;
let gemini = null;
const GEMINI_MODEL = 'gemini-2.5-pro'; // Meilleur modèle pour analyse visuelle détaillée

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized');
  } catch (e) {
    console.warn('[SWITCHBOARD] OpenAI init failed:', e.message);
  }
}

if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
  try {
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    console.log('[SWITCHBOARD] Gemini initialized');
  } catch (e) {
    console.warn('[SWITCHBOARD] Gemini init failed:', e.message);
  }
}

// Helper: Call AI with fallback
async function callAIWithFallback(openaiCall, geminiCall, context = 'AI') {
  if (openai) {
    try {
      return await openaiCall();
    } catch (err) {
      console.error(`[SWITCHBOARD] OpenAI ${context} failed:`, err.message);
      const isQuotaError = err.status === 429 || err.message?.includes('429') || err.message?.includes('quota');
      if (gemini && isQuotaError) {
        console.log(`[SWITCHBOARD] ⚡ Fallback to Gemini for ${context}...`);
        return await geminiCall();
      }
      throw err;
    }
  }
  if (gemini) {
    console.log(`[SWITCHBOARD] Using Gemini for ${context} (no OpenAI)...`);
    return await geminiCall();
  }
  throw new Error('No AI provider available');
}

// ============================================================
// EXPRESS SETUP
// ============================================================
const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "blob:"],
      workerSrc: ["'self'", "blob:", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", process.env.CORS_ORIGIN || "*", "https://api.openai.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,X-User-Email,X-User-Name');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============================================================
// MIDDLEWARE: Request timeout protection + logging
// ============================================================
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 10);

  // ✅ TIMEOUT GLOBAL par requête (15s max pour les endpoints normaux)
  // Les endpoints PUT/POST peuvent avoir leurs propres timeouts plus courts
  const globalTimeout = setTimeout(() => {
    if (!res.headersSent) {
      const elapsed = Date.now() - start;
      console.error(`[TIMEOUT] ${req.method} ${req.path} killed after ${elapsed}ms (request ${requestId})`);
      res.status(504).json({
        error: 'Request timeout - le serveur a mis trop de temps à répondre',
        elapsed_ms: elapsed,
        request_id: requestId
      });
    }
  }, 15000);

  // ✅ Cleanup du timeout quand la requête se termine
  res.on('finish', () => {
    clearTimeout(globalTimeout);
    const elapsed = Date.now() - start;
    if (elapsed > 5000) {
      console.warn(`[SLOW REQUEST] ${req.method} ${req.path} took ${elapsed}ms (request ${requestId})`);
    }
  });

  res.on('close', () => {
    clearTimeout(globalTimeout);
    if (!res.writableEnded) {
      const elapsed = Date.now() - start;
      console.warn(`[ABORTED] ${req.method} ${req.path} closed by client after ${elapsed}ms (request ${requestId})`);
    }
  });

  next();
});

// ============================================================
// HELPERS
// ============================================================
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString().trim();
}

const WHITELIST_SORT = ['created_at', 'name', 'code', 'building_code', 'floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

function checkDeviceComplete(device) {
  if (!device || typeof device !== 'object') return false;
  return !!(device.manufacturer && device.reference && device.in_amps && Number(device.in_amps) > 0);
}

// ============================================================
// HEALTH CHECK - ENHANCED v3.0
// ============================================================
app.get('/api/switchboard/health', async (req, res) => {
  try {
    const dbStart = Date.now();
    await quickQuery('SELECT 1', [], 2000, 0); // No retry for health check
    const dbTime = Date.now() - dbStart;

    res.json({
      ok: true,
      ts: Date.now(),
      version: '3.0',
      openai: !!openai,
      db: {
        connected: true,
        responseTime: dbTime,
        cold: dbTime > 500 // Indication si cold start
      },
      pool: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        maxConnections: 20
      },
      stats: {
        ...poolStats,
        successRate: poolStats.queries > 0
          ? ((poolStats.queries - poolStats.errors) / poolStats.queries * 100).toFixed(1) + '%'
          : '100%'
      }
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
      pool: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      stats: poolStats
    });
  }
});

// ============================================================
// SCHEMA INITIALIZATION - AVEC TRIGGERS POUR COUNTS AUTOMATIQUES
// ============================================================
async function ensureSchema() {
  await pool.query(`
    -- =======================================================
    -- TABLE: Switchboards (avec colonnes de cache pour counts)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS switchboards (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      building_code TEXT,
      floor TEXT,
      room TEXT,
      regime_neutral TEXT,
      is_principal BOOLEAN DEFAULT FALSE,
      photo BYTEA,
      modes JSONB DEFAULT '{}'::jsonb,
      quality JSONB DEFAULT '{}'::jsonb,
      diagram_data JSONB DEFAULT '{}'::jsonb,
      -- COLONNES DE CACHE POUR ÉVITER LES REQUÊTES COUNT
      device_count INTEGER DEFAULT 0,
      complete_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Migration: add updated_at if missing
    ALTER TABLE switchboards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_switchboards_site ON switchboards(site);
    CREATE INDEX IF NOT EXISTS idx_switchboards_building ON switchboards(building_code);
    CREATE INDEX IF NOT EXISTS idx_switchboards_code ON switchboards(code);
    CREATE INDEX IF NOT EXISTS idx_switchboards_site_code ON switchboards(site, code);

    -- Add created_by columns for ownership tracking
    ALTER TABLE switchboards ADD COLUMN IF NOT EXISTS created_by_email TEXT;
    ALTER TABLE switchboards ADD COLUMN IF NOT EXISTS created_by_name TEXT;

    -- =======================================================
    -- TABLE: Switchboard Categories (types de tableaux avec couleurs)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS switchboard_categories (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#F59E0B',
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_switchboard_categories_site ON switchboard_categories(site);

    -- Add category_id to switchboards
    ALTER TABLE switchboards ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES switchboard_categories(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_switchboards_category ON switchboards(category_id);

    -- =======================================================
    -- TABLE: Devices
    -- =======================================================
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      downstream_switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE SET NULL,
      name TEXT,
      device_type TEXT NOT NULL DEFAULT 'Low Voltage Circuit Breaker',
      manufacturer TEXT,
      reference TEXT,
      in_amps NUMERIC,
      icu_ka NUMERIC,
      ics_ka NUMERIC,
      poles INTEGER,
      voltage_v NUMERIC,
      trip_unit TEXT,
      position_number TEXT,
      is_differential BOOLEAN DEFAULT FALSE,
      is_complete BOOLEAN DEFAULT FALSE,
      settings JSONB DEFAULT '{}'::jsonb,
      is_main_incoming BOOLEAN DEFAULT FALSE,
      pv_tests BYTEA,
      photos BYTEA[],
      diagram_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard ON devices(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_parent ON devices(parent_id);
    CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site);
    CREATE INDEX IF NOT EXISTS idx_devices_reference ON devices(reference);
    CREATE INDEX IF NOT EXISTS idx_devices_downstream ON devices(downstream_switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_manufacturer ON devices(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_devices_complete ON devices(is_complete);

    -- Add created_by columns for ownership tracking
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS created_by_email TEXT;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS created_by_name TEXT;
    -- Index composite CRITIQUE pour les counts
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard_complete ON devices(switchboard_id, is_complete);

    -- ✅ INDEX ADDITIONNELS v3.0 pour performance
    -- Index pour tri par position_number (très utilisé)
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard_position ON devices(switchboard_id, position_number);
    -- Index partiel pour devices incomplets (requêtes "à compléter")
    CREATE INDEX IF NOT EXISTS idx_devices_incomplete ON devices(switchboard_id) WHERE is_complete = false;
    -- Index pour recherche par site + switchboard (multi-tenant)
    CREATE INDEX IF NOT EXISTS idx_devices_site_switchboard ON devices(site, switchboard_id);

    -- ✅ CONTRAINTE UNIQUE: Pas de doublons de position par tableau
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'devices_switchboard_position_unique'
      ) THEN
        -- Nettoyer les doublons existants avant d'ajouter la contrainte
        DELETE FROM devices a USING devices b
        WHERE a.id < b.id
          AND a.switchboard_id = b.switchboard_id
          AND a.position_number = b.position_number
          AND a.position_number IS NOT NULL;
        -- Ajouter la contrainte
        ALTER TABLE devices ADD CONSTRAINT devices_switchboard_position_unique
          UNIQUE (switchboard_id, position_number);
      END IF;
    EXCEPTION WHEN others THEN
      -- Ignore si la contrainte existe déjà ou si le nettoyage échoue
      NULL;
    END $$;

    -- =======================================================
    -- TABLE: Site Settings
    -- =======================================================
    CREATE TABLE IF NOT EXISTS site_settings (
      id SERIAL PRIMARY KEY,
      site TEXT UNIQUE NOT NULL,
      logo BYTEA,
      logo_mime TEXT DEFAULT 'image/png',
      company_name TEXT,
      company_address TEXT,
      company_phone TEXT,
      company_email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- =======================================================
    -- TABLE: Switchboard Photos Gallery
    -- =======================================================
    CREATE TABLE IF NOT EXISTS switchboard_photos (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      photo BYTEA NOT NULL,
      thumbnail BYTEA,
      source TEXT DEFAULT 'manual',
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_switchboard_photos_board ON switchboard_photos(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_switchboard_photos_site ON switchboard_photos(site);

    -- =======================================================
    -- TABLE: Scanned Products Cache
    -- =======================================================
    CREATE TABLE IF NOT EXISTS scanned_products (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      reference TEXT NOT NULL,
      manufacturer TEXT,
      device_type TEXT DEFAULT 'Low Voltage Circuit Breaker',
      in_amps NUMERIC,
      icu_ka NUMERIC,
      ics_ka NUMERIC,
      poles INTEGER,
      voltage_v NUMERIC,
      trip_unit TEXT,
      is_differential BOOLEAN DEFAULT FALSE,
      settings JSONB DEFAULT '{}'::jsonb,
      photo_thumbnail BYTEA,
      scan_count INTEGER DEFAULT 1,
      last_scanned_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      validated BOOLEAN DEFAULT FALSE,
      source TEXT DEFAULT 'photo_scan',
      curve_type TEXT
    );

    -- Migrations: add columns if missing
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS curve_type TEXT;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS ics_ka NUMERIC;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS voltage_v NUMERIC;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS icu_ka NUMERIC;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS poles INTEGER;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS differential_sensitivity_ma NUMERIC;
    ALTER TABLE scanned_products ADD COLUMN IF NOT EXISTS differential_type TEXT;

    CREATE INDEX IF NOT EXISTS idx_scanned_products_site ON scanned_products(site);
    CREATE INDEX IF NOT EXISTS idx_scanned_products_reference ON scanned_products(reference);
    CREATE INDEX IF NOT EXISTS idx_scanned_products_manufacturer ON scanned_products(manufacturer);

    -- Migration: deduplicate scanned_products before creating unique index
    -- Keep the entry with highest id for each (site, normalized_reference) pair
    -- Normalization: lowercase, remove all non-alphanumeric characters
    DELETE FROM scanned_products a USING scanned_products b
    WHERE a.id < b.id
      AND a.site = b.site
      AND LOWER(REGEXP_REPLACE(a.reference, '[^a-zA-Z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE(b.reference, '[^a-zA-Z0-9]', '', 'g'));

    -- Normalize existing references (lowercase, alphanumeric only)
    UPDATE scanned_products
    SET reference = LOWER(REGEXP_REPLACE(reference, '[^a-zA-Z0-9]', '', 'g'))
    WHERE reference IS NOT NULL
      AND reference != LOWER(REGEXP_REPLACE(reference, '[^a-zA-Z0-9]', '', 'g'));

    -- UNIQUE constraint for ON CONFLICT upsert (site + reference)
    -- Note: reference should be normalized (lowercase, trimmed) before insertion
    CREATE UNIQUE INDEX IF NOT EXISTS idx_scanned_products_site_reference
      ON scanned_products(site, reference);

    -- =======================================================
    -- TABLE: Control Templates (Modèles de formulaires)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_templates (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      target_type TEXT NOT NULL DEFAULT 'switchboard', -- 'switchboard' ou 'device'
      frequency_months INTEGER DEFAULT 12,
      checklist_items JSONB DEFAULT '[]'::jsonb,
      -- Format: [{ "id": "uuid", "label": "...", "type": "conform|text|value", "unit": "V|A|etc", "required": false }]
      is_active BOOLEAN DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_control_templates_site ON control_templates(site);
    CREATE INDEX IF NOT EXISTS idx_control_templates_type ON control_templates(target_type);

    -- =======================================================
    -- TABLE: Control Schedules (Planification des contrôles)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_schedules (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      template_id INTEGER REFERENCES control_templates(id) ON DELETE CASCADE,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      next_due_date DATE,
      last_control_date DATE,
      last_control_id INTEGER,
      status TEXT DEFAULT 'pending', -- 'pending', 'overdue', 'done'
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT check_target CHECK (
        (switchboard_id IS NOT NULL AND device_id IS NULL) OR
        (switchboard_id IS NULL AND device_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_control_schedules_site ON control_schedules(site);
    CREATE INDEX IF NOT EXISTS idx_control_schedules_switchboard ON control_schedules(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_control_schedules_device ON control_schedules(device_id);
    CREATE INDEX IF NOT EXISTS idx_control_schedules_status ON control_schedules(status);
    CREATE INDEX IF NOT EXISTS idx_control_schedules_due ON control_schedules(next_due_date);

    -- =======================================================
    -- TABLE: Control Records (Historique des contrôles)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_records (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      schedule_id INTEGER REFERENCES control_schedules(id) ON DELETE SET NULL,
      template_id INTEGER REFERENCES control_templates(id) ON DELETE SET NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      performed_by TEXT NOT NULL,
      performed_by_email TEXT,
      performed_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT DEFAULT 'conform', -- 'conform', 'non_conform', 'partial'
      checklist_results JSONB DEFAULT '[]'::jsonb,
      -- Format: [{ "item_id": "...", "status": "conform|non_conform|na", "value": "...", "comment": "..." }]
      global_notes TEXT,
      signature_base64 TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_control_records_site ON control_records(site);
    CREATE INDEX IF NOT EXISTS idx_control_records_switchboard ON control_records(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_control_records_device ON control_records(device_id);
    CREATE INDEX IF NOT EXISTS idx_control_records_date ON control_records(performed_at);
    CREATE INDEX IF NOT EXISTS idx_control_records_status ON control_records(status);

    -- =======================================================
    -- TABLE: Control Attachments (Photos & Documents)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_attachments (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      control_record_id INTEGER REFERENCES control_records(id) ON DELETE CASCADE,
      checklist_item_id TEXT, -- Lié à un item de checklist (optionnel)
      file_type TEXT DEFAULT 'photo', -- 'photo', 'document'
      file_name TEXT,
      file_mime TEXT,
      file_data BYTEA,
      thumbnail BYTEA,
      caption TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_control_attachments_record ON control_attachments(control_record_id);
    CREATE INDEX IF NOT EXISTS idx_control_attachments_site ON control_attachments(site);

    -- =======================================================
    -- TABLE: Control Drafts (Brouillons de contrôle en cours)
    -- Permet de sauvegarder les contrôles non validés
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_drafts (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      schedule_id INTEGER NOT NULL REFERENCES control_schedules(id) ON DELETE CASCADE,
      checklist_results JSONB DEFAULT '[]'::jsonb,
      global_notes TEXT,
      status TEXT DEFAULT 'conform',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(site, schedule_id)
    );
    CREATE INDEX IF NOT EXISTS idx_control_drafts_schedule ON control_drafts(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_control_drafts_site ON control_drafts(site);

    -- =======================================================
    -- TABLE: Control Draft Attachments (Photos en brouillon)
    -- Stocke les photos avant validation du contrôle
    -- =======================================================
    CREATE TABLE IF NOT EXISTS control_draft_attachments (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      draft_id INTEGER REFERENCES control_drafts(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL,
      file_type TEXT DEFAULT 'photo',
      file_name TEXT,
      file_mime TEXT,
      file_data BYTEA,
      thumbnail BYTEA,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_control_draft_attachments_draft ON control_draft_attachments(draft_id);
    CREATE INDEX IF NOT EXISTS idx_control_draft_attachments_schedule ON control_draft_attachments(schedule_id);

    -- =======================================================
    -- VIEW: control_reports (compatibility alias for control_records)
    -- Maps old column names to new column names for legacy code
    -- =======================================================
    CREATE OR REPLACE VIEW control_reports AS
    SELECT
      id,
      site,
      schedule_id,
      template_id,
      switchboard_id,
      device_id,
      performed_by AS user_name,
      performed_by_email AS user_email,
      performed_at AS control_date,
      CASE
        WHEN status = 'conform' THEN 'conforme'
        WHEN status = 'non_conform' THEN 'non_conforme'
        ELSE status
      END AS result,
      checklist_results AS items,
      global_notes AS notes,
      signature_base64,
      created_at
    FROM control_records;

    -- =======================================================
    -- TABLE: Panel Scan Jobs (persistance des analyses IA)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS panel_scan_jobs (
      id TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE SET NULL,
      user_email TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      message TEXT,
      photos_count INTEGER DEFAULT 0,
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      notified BOOLEAN DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_panel_scan_jobs_site ON panel_scan_jobs(site);
    CREATE INDEX IF NOT EXISTS idx_panel_scan_jobs_user ON panel_scan_jobs(user_email);
    CREATE INDEX IF NOT EXISTS idx_panel_scan_jobs_status ON panel_scan_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_panel_scan_jobs_created ON panel_scan_jobs(created_at DESC);

    -- =======================================================
    -- TABLE: Switchboard Audit Log (traçabilité des modifications)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS switchboard_audit_log (
      id SERIAL PRIMARY KEY,
      site TEXT,
      action TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      actor_name TEXT,
      actor_email TEXT,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add missing columns if table was created by lib/audit-trail.js with different schema
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'site') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN site TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'action') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN action TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'entity_type') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN entity_type TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'entity_id') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN entity_id INTEGER;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'actor_name') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN actor_name TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'actor_email') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN actor_email TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboard_audit_log' AND column_name = 'details') THEN
        ALTER TABLE switchboard_audit_log ADD COLUMN details JSONB DEFAULT '{}'::jsonb;
      END IF;
    END $$;

    -- Now safe to create indexes (columns guaranteed to exist)
    CREATE INDEX IF NOT EXISTS idx_switchboard_audit_log_site ON switchboard_audit_log(site);
    CREATE INDEX IF NOT EXISTS idx_switchboard_audit_log_entity ON switchboard_audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_switchboard_audit_log_actor ON switchboard_audit_log(actor_email);
    CREATE INDEX IF NOT EXISTS idx_switchboard_audit_log_date ON switchboard_audit_log(created_at);

    -- =======================================================
    -- MIGRATIONS: Ajouter colonnes manquantes
    -- =======================================================
    DO $$
    BEGIN
      -- Switchboards columns
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'photo') THEN
        ALTER TABLE switchboards ADD COLUMN photo BYTEA;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'modes') THEN
        ALTER TABLE switchboards ADD COLUMN modes JSONB DEFAULT '{}'::jsonb;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'quality') THEN
        ALTER TABLE switchboards ADD COLUMN quality JSONB DEFAULT '{}'::jsonb;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'regime_neutral') THEN
        ALTER TABLE switchboards ADD COLUMN regime_neutral TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'is_principal') THEN
        ALTER TABLE switchboards ADD COLUMN is_principal BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'diagram_data') THEN
        ALTER TABLE switchboards ADD COLUMN diagram_data JSONB DEFAULT '{}'::jsonb;
      END IF;
      -- NOUVELLES COLONNES POUR CACHE DES COUNTS
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'device_count') THEN
        ALTER TABLE switchboards ADD COLUMN device_count INTEGER DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'complete_count') THEN
        ALTER TABLE switchboards ADD COLUMN complete_count INTEGER DEFAULT 0;
      END IF;
      -- Settings column for listing data and other metadata
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'settings') THEN
        ALTER TABLE switchboards ADD COLUMN settings JSONB DEFAULT '{}'::jsonb;
      END IF;

      -- Devices columns
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'name') THEN
        ALTER TABLE devices ADD COLUMN name TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'position_number') THEN
        ALTER TABLE devices ADD COLUMN position_number TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'is_differential') THEN
        ALTER TABLE devices ADD COLUMN is_differential BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'is_complete') THEN
        ALTER TABLE devices ADD COLUMN is_complete BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'diagram_data') THEN
        ALTER TABLE devices ADD COLUMN diagram_data JSONB DEFAULT '{}'::jsonb;
      END IF;

      -- =====================================================
      -- CONTROL SCHEDULES: Colonnes pour VSD, MECA, Mobile Equipment, HV
      -- =====================================================
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'vsd_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN vsd_equipment_id INTEGER;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'meca_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN meca_equipment_id UUID;
      ELSE
        -- Migrate from INTEGER to UUID if needed (meca_equipments uses UUID)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'meca_equipment_id' AND data_type = 'integer') THEN
          ALTER TABLE control_schedules DROP COLUMN meca_equipment_id;
          ALTER TABLE control_schedules ADD COLUMN meca_equipment_id UUID;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'mobile_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN mobile_equipment_id UUID;
      ELSE
        -- Migrate from INTEGER to UUID if needed (me_equipments uses UUID)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'mobile_equipment_id' AND data_type = 'integer') THEN
          ALTER TABLE control_schedules DROP COLUMN mobile_equipment_id;
          ALTER TABLE control_schedules ADD COLUMN mobile_equipment_id UUID;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'hv_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN hv_equipment_id INTEGER;
      ELSE
        -- Migrate from UUID to INTEGER if needed (hv_equipments uses SERIAL integer id)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'hv_equipment_id' AND data_type = 'uuid') THEN
          ALTER TABLE control_schedules DROP COLUMN hv_equipment_id;
          ALTER TABLE control_schedules ADD COLUMN hv_equipment_id INTEGER;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'glo_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN glo_equipment_id UUID;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'datahub_equipment_id') THEN
        ALTER TABLE control_schedules ADD COLUMN datahub_equipment_id UUID;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_schedules' AND column_name = 'equipment_type') THEN
        ALTER TABLE control_schedules ADD COLUMN equipment_type TEXT DEFAULT 'switchboard';
      END IF;

      -- =====================================================
      -- CONTROL RECORDS: Colonnes pour VSD, MECA, Mobile Equipment, HV
      -- =====================================================
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'vsd_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN vsd_equipment_id INTEGER;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'meca_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN meca_equipment_id UUID;
      ELSE
        -- Migrate from INTEGER to UUID if needed (meca_equipments uses UUID)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'meca_equipment_id' AND data_type = 'integer') THEN
          ALTER TABLE control_records DROP COLUMN meca_equipment_id;
          ALTER TABLE control_records ADD COLUMN meca_equipment_id UUID;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'mobile_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN mobile_equipment_id UUID;
      ELSE
        -- Migrate from INTEGER to UUID if needed (me_equipments uses UUID)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'mobile_equipment_id' AND data_type = 'integer') THEN
          ALTER TABLE control_records DROP COLUMN mobile_equipment_id;
          ALTER TABLE control_records ADD COLUMN mobile_equipment_id UUID;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'hv_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN hv_equipment_id INTEGER;
      ELSE
        -- Migrate from UUID to INTEGER if needed (hv_equipments uses SERIAL integer id)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'hv_equipment_id' AND data_type = 'uuid') THEN
          ALTER TABLE control_records DROP COLUMN hv_equipment_id;
          ALTER TABLE control_records ADD COLUMN hv_equipment_id INTEGER;
        END IF;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'glo_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN glo_equipment_id UUID;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'datahub_equipment_id') THEN
        ALTER TABLE control_records ADD COLUMN datahub_equipment_id UUID;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_records' AND column_name = 'equipment_type') THEN
        ALTER TABLE control_records ADD COLUMN equipment_type TEXT DEFAULT 'switchboard';
      END IF;

      -- =====================================================
      -- CONTROL TEMPLATES: Nouveaux target_type + element_filter
      -- =====================================================
      -- Les target_type supportés sont maintenant: switchboard, device, vsd, meca, mobile_equipment
      -- element_filter permet de filtrer par type d'élément (ex: 'ddr' pour ne cibler que les DDR)

      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'control_templates' AND column_name = 'element_filter') THEN
        ALTER TABLE control_templates ADD COLUMN element_filter TEXT;
        -- Valeurs possibles: null (tous), 'ddr' (DDR uniquement), 'disjoncteur' (disjoncteurs non-DDR)
      END IF;

      -- Supprimer l'ancienne contrainte si elle existe
      BEGIN
        ALTER TABLE control_schedules DROP CONSTRAINT IF EXISTS check_target;
      EXCEPTION WHEN undefined_object THEN NULL;
      END;

      -- Index pour les nouvelles colonnes
      CREATE INDEX IF NOT EXISTS idx_control_schedules_vsd ON control_schedules(vsd_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_schedules_meca ON control_schedules(meca_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_schedules_mobile ON control_schedules(mobile_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_schedules_hv ON control_schedules(hv_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_schedules_glo ON control_schedules(glo_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_schedules_type ON control_schedules(equipment_type);
      CREATE INDEX IF NOT EXISTS idx_control_records_vsd ON control_records(vsd_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_records_meca ON control_records(meca_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_records_mobile ON control_records(mobile_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_records_hv ON control_records(hv_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_records_glo ON control_records(glo_equipment_id);
      CREATE INDEX IF NOT EXISTS idx_control_records_type ON control_records(equipment_type);

      -- =====================================================
      -- OBSOLESCENCE & LIFECYCLE TRACKING
      -- =====================================================
      -- Switchboards obsolescence
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'installation_date') THEN
        ALTER TABLE switchboards ADD COLUMN installation_date DATE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'expected_lifespan_years') THEN
        ALTER TABLE switchboards ADD COLUMN expected_lifespan_years INTEGER DEFAULT 25;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'end_of_life_date') THEN
        ALTER TABLE switchboards ADD COLUMN end_of_life_date DATE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'replacement_planned_date') THEN
        ALTER TABLE switchboards ADD COLUMN replacement_planned_date DATE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'obsolescence_status') THEN
        ALTER TABLE switchboards ADD COLUMN obsolescence_status TEXT DEFAULT 'active';
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'lifecycle_notes') THEN
        ALTER TABLE switchboards ADD COLUMN lifecycle_notes TEXT;
      END IF;

      -- Devices obsolescence
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'installation_date') THEN
        ALTER TABLE devices ADD COLUMN installation_date DATE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'expected_lifespan_years') THEN
        ALTER TABLE devices ADD COLUMN expected_lifespan_years INTEGER DEFAULT 20;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'end_of_life_date') THEN
        ALTER TABLE devices ADD COLUMN end_of_life_date DATE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'obsolescence_status') THEN
        ALTER TABLE devices ADD COLUMN obsolescence_status TEXT DEFAULT 'active';
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'spare_parts_available') THEN
        ALTER TABLE devices ADD COLUMN spare_parts_available BOOLEAN DEFAULT true;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'manufacturer_support_until') THEN
        ALTER TABLE devices ADD COLUMN manufacturer_support_until DATE;
      END IF;

      -- Equipment live status for animation
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'live_status') THEN
        ALTER TABLE switchboards ADD COLUMN live_status TEXT DEFAULT 'normal';
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'last_status_update') THEN
        ALTER TABLE switchboards ADD COLUMN last_status_update TIMESTAMPTZ;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'live_status') THEN
        ALTER TABLE devices ADD COLUMN live_status TEXT DEFAULT 'normal';
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'last_status_update') THEN
        ALTER TABLE devices ADD COLUMN last_status_update TIMESTAMPTZ;
      END IF;

      -- =====================================================
      -- FIRE INTERLOCK: Lien avec système asservissement incendie
      -- =====================================================
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'fire_interlock') THEN
        ALTER TABLE switchboards ADD COLUMN fire_interlock BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'fire_interlock_zone_id') THEN
        ALTER TABLE switchboards ADD COLUMN fire_interlock_zone_id UUID;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'fire_interlock_alarm_level') THEN
        ALTER TABLE switchboards ADD COLUMN fire_interlock_alarm_level INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'fire_interlock_code') THEN
        ALTER TABLE switchboards ADD COLUMN fire_interlock_code TEXT;
      END IF;

      -- =====================================================
      -- DEVICES: Colonnes additionnelles pour scan complet
      -- =====================================================
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'curve_type') THEN
        ALTER TABLE devices ADD COLUMN curve_type TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'differential_sensitivity_ma') THEN
        ALTER TABLE devices ADD COLUMN differential_sensitivity_ma NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'differential_type') THEN
        ALTER TABLE devices ADD COLUMN differential_type TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'ics_ka') THEN
        ALTER TABLE devices ADD COLUMN ics_ka NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'voltage_v') THEN
        ALTER TABLE devices ADD COLUMN voltage_v NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'icu_ka') THEN
        ALTER TABLE devices ADD COLUMN icu_ka NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'poles') THEN
        ALTER TABLE devices ADD COLUMN poles INTEGER;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'in_amps') THEN
        ALTER TABLE devices ADD COLUMN in_amps NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'trip_unit') THEN
        ALTER TABLE devices ADD COLUMN trip_unit TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'settings') THEN
        ALTER TABLE devices ADD COLUMN settings JSONB DEFAULT '{}'::jsonb;
      END IF;

      -- =====================================================
      -- PANEL SCAN JOBS: Images storage for resume after restart
      -- =====================================================
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'panel_scan_jobs' AND column_name = 'images_data') THEN
        ALTER TABLE panel_scan_jobs ADD COLUMN images_data TEXT;
      END IF;

    END $$;

    -- =======================================================
    -- TRIGGER: updated_at automatique
    -- =======================================================
    CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_devices_updated_at') THEN
        CREATE TRIGGER update_devices_updated_at
        BEFORE UPDATE ON devices
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_settings_updated_at') THEN
        CREATE TRIGGER update_settings_updated_at
        BEFORE UPDATE ON site_settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;

    -- =======================================================
    -- TRIGGER: Mise à jour automatique des counts switchboard
    -- VERSION V2 OPTIMISÉE - O(1) avec incréments atomiques
    -- =======================================================
    CREATE OR REPLACE FUNCTION update_switchboard_counts() RETURNS TRIGGER AS $$
    BEGIN
      -- INSERT: incrémenter les compteurs
      IF TG_OP = 'INSERT' THEN
        UPDATE switchboards SET
          device_count = device_count + 1,
          complete_count = complete_count + CASE WHEN NEW.is_complete THEN 1 ELSE 0 END
        WHERE id = NEW.switchboard_id;
        RETURN NEW;
      
      -- DELETE: décrémenter les compteurs
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE switchboards SET
          device_count = GREATEST(0, device_count - 1),
          complete_count = GREATEST(0, complete_count - CASE WHEN OLD.is_complete THEN 1 ELSE 0 END)
        WHERE id = OLD.switchboard_id;
        RETURN OLD;
      
      -- UPDATE: gérer les changements
      ELSIF TG_OP = 'UPDATE' THEN
        -- Cas 1: même switchboard, seul is_complete change
        IF OLD.switchboard_id = NEW.switchboard_id THEN
          IF OLD.is_complete IS DISTINCT FROM NEW.is_complete THEN
            UPDATE switchboards SET
              complete_count = GREATEST(0, complete_count + CASE WHEN NEW.is_complete THEN 1 ELSE -1 END)
            WHERE id = NEW.switchboard_id;
          END IF;
        -- Cas 2: changement de switchboard (rare)
        ELSE
          -- Décrémenter l'ancien
          IF OLD.switchboard_id IS NOT NULL THEN
            UPDATE switchboards SET
              device_count = GREATEST(0, device_count - 1),
              complete_count = GREATEST(0, complete_count - CASE WHEN OLD.is_complete THEN 1 ELSE 0 END)
            WHERE id = OLD.switchboard_id;
          END IF;
          -- Incrémenter le nouveau
          IF NEW.switchboard_id IS NOT NULL THEN
            UPDATE switchboards SET
              device_count = device_count + 1,
              complete_count = complete_count + CASE WHEN NEW.is_complete THEN 1 ELSE 0 END
            WHERE id = NEW.switchboard_id;
          END IF;
        END IF;
        RETURN NEW;
      END IF;
      
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    -- Supprimer l'ancien trigger et recréer
    DROP TRIGGER IF EXISTS trigger_update_switchboard_counts ON devices;
    CREATE TRIGGER trigger_update_switchboard_counts
    AFTER INSERT OR UPDATE OR DELETE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_switchboard_counts();

    -- =======================================================
    -- RECALCULER TOUS LES COUNTS EXISTANTS
    -- Note: vérifie et corrige les compteurs désynchronisés à chaque démarrage
    -- =======================================================
    UPDATE switchboards s SET
      device_count = COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id), 0),
      complete_count = COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id AND d.is_complete = true), 0)
    WHERE device_count IS NULL
       OR complete_count IS NULL
       OR device_count < 0
       OR complete_count < 0
       OR complete_count > device_count
       OR device_count != COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id), 0)
       OR complete_count != COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id AND d.is_complete = true), 0);

    -- =======================================================
    -- TABLE: Equipment Links (liens manuels entre équipements)
    -- Permet de lier n'importe quel équipement à un autre
    -- =======================================================
    CREATE TABLE IF NOT EXISTS equipment_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT NOT NULL,

      -- Source equipment (polymorphic)
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,

      -- Target equipment (polymorphic)
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,

      -- Metadata
      link_label TEXT DEFAULT 'connected',
      description TEXT,

      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),

      -- Prevent duplicate links
      UNIQUE(site, source_type, source_id, target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_links_source ON equipment_links(site, source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_equipment_links_target ON equipment_links(site, target_type, target_id);
  `);
  
  console.log('[SWITCHBOARD SCHEMA] Initialized with O(1) auto-count triggers v2');
}

ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA ERROR]', e.message));

// ============================================================
// AUDIT TRAIL - Traçabilité des modifications
// ============================================================
const audit = createAuditTrail(pool, 'switchboard');
audit.ensureTable().catch(e => console.error('[SWITCHBOARD AUDIT ERROR]', e.message));

// ============================================================
// PANEL SCAN JOBS - Recovery of stuck jobs after server restart
// ============================================================
async function recoverStuckPanelScanJobs() {
  try {
    // Find jobs that were in progress when server died (status = 'analyzing' or 'pending')
    // and are older than 5 minutes (to avoid interfering with genuinely running jobs)
    const { rows: stuckJobs } = await pool.query(`
      SELECT id, site, switchboard_id, user_email, status, progress, created_at
      FROM panel_scan_jobs
      WHERE status IN ('analyzing', 'pending', 'processing')
        AND completed_at IS NULL
        AND created_at < NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (stuckJobs.length === 0) {
      console.log('[PANEL SCAN] No stuck jobs to recover');
      return;
    }

    console.log(`[PANEL SCAN] Found ${stuckJobs.length} stuck jobs to mark as failed`);

    for (const job of stuckJobs) {
      console.log(`[PANEL SCAN] Marking job ${job.id} as failed (was at ${job.progress}% - ${job.status})`);

      await pool.query(`
        UPDATE panel_scan_jobs
        SET status = 'failed',
            error = 'Analyse interrompue suite à un redémarrage du serveur. Veuillez relancer le scan.',
            completed_at = NOW()
        WHERE id = $1
      `, [job.id]);

      // Notify user that their job failed
      if (job.user_email) {
        try {
          const { notifyUser } = await import('./lib/push-notify.js');
          await notifyUser(job.user_email,
            '⚠️ Scan interrompu',
            'Le scan a été interrompu suite à une maintenance. Veuillez le relancer.',
            {
              type: 'panel_scan_interrupted',
              tag: `panel-scan-${job.id}`,
              data: { jobId: job.id, switchboardId: job.switchboard_id }
            }
          );
        } catch (e) {
          console.warn(`[PANEL SCAN] Could not notify user ${job.user_email}:`, e.message);
        }
      }
    }

    console.log(`[PANEL SCAN] ✅ Recovered ${stuckJobs.length} stuck jobs`);
  } catch (e) {
    console.error('[PANEL SCAN] Error recovering stuck jobs:', e.message);
  }
}

// Run recovery after a short delay (give DB connection time to stabilize)
setTimeout(() => {
  recoverStuckPanelScanJobs().catch(e => console.error('[PANEL SCAN] Recovery failed:', e.message));
}, 10000); // 10s after startup

// Helper pour extraire l'utilisateur actuel
function getUser(req) {
  return {
    name: req.user?.name || req.headers['x-user-name'] || null,
    email: req.user?.email || req.headers['x-user-email'] || null
  };
}

// ============================================================
// SITE SETTINGS
// ============================================================

app.get('/api/switchboard/settings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const r = await quickQuery(
      `SELECT id, site, company_name, company_address, company_phone, company_email, 
              (logo IS NOT NULL) as has_logo, created_at, updated_at
       FROM site_settings WHERE site = $1`, [site]
    );

    if (!r.rows.length) {
      return res.json({ site, has_logo: false, company_name: null, company_address: null, company_phone: null, company_email: null });
    }
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[SETTINGS GET]', e.message);
    res.status(500).json({ error: 'Get settings failed' });
  }
});

app.put('/api/switchboard/settings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    const { company_name, company_address, company_phone, company_email } = req.body || {};

    const r = await quickQuery(`
      INSERT INTO site_settings (site, company_name, company_address, company_phone, company_email)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (site) DO UPDATE SET 
        company_name = COALESCE($2, site_settings.company_name),
        company_address = COALESCE($3, site_settings.company_address),
        company_phone = COALESCE($4, site_settings.company_phone),
        company_email = COALESCE($5, site_settings.company_email),
        updated_at = NOW()
      RETURNING id, site, company_name, company_address, company_phone, company_email, (logo IS NOT NULL) as has_logo
    `, [site, company_name || null, company_address || null, company_phone || null, company_email || null]);

    res.json(r.rows[0]);
  } catch (e) {
    console.error('[SETTINGS UPDATE]', e.message);
    res.status(500).json({ error: 'Update settings failed' });
  }
});

app.post('/api/switchboard/settings/logo', upload.single('logo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    if (!req.file) return res.status(400).json({ error: 'No logo provided' });

    await quickQuery(`
      INSERT INTO site_settings (site, logo, logo_mime) VALUES ($1, $2, $3)
      ON CONFLICT (site) DO UPDATE SET logo = $2, logo_mime = $3, updated_at = NOW()
    `, [site, req.file.buffer, req.file.mimetype || 'image/png']);

    res.json({ success: true });
  } catch (e) {
    console.error('[LOGO UPLOAD]', e.message);
    res.status(500).json({ error: 'Logo upload failed' });
  }
});

app.get('/api/switchboard/settings/logo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const r = await quickQuery(`SELECT logo, logo_mime FROM site_settings WHERE site = $1`, [site]);
    if (!r.rows.length || !r.rows[0].logo) return res.status(404).json({ error: 'Logo not found' });

    res.set('Content-Type', r.rows[0].logo_mime || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].logo);
  } catch (e) {
    console.error('[LOGO GET]', e.message);
    res.status(500).json({ error: 'Get logo failed' });
  }
});

app.delete('/api/switchboard/settings/logo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    await quickQuery(`UPDATE site_settings SET logo = NULL, logo_mime = NULL, updated_at = NOW() WHERE site = $1`, [site]);
    res.json({ success: true });
  } catch (e) {
    console.error('[LOGO DELETE]', e.message);
    res.status(500).json({ error: 'Delete logo failed' });
  }
});

// ============================================================
// SWITCHBOARDS CRUD
// ============================================================

// GET /boards - RETOURNE MAINTENANT LES COUNTS DIRECTEMENT (plus besoin de devices-count)
app.get('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '100' } = req.query;
    const where = ['site = $1']; 
    const vals = [site]; 
    let i = 2;
    
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    
    const limit = Math.min(parseInt(pageSize, 10) || 100, 500);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    // REQUÊTE OPTIMISÉE: inclut device_count, complete_count, photos_count et category directement
    const sql = `
      SELECT s.id, s.site, s.name, s.code, s.building_code, s.floor, s.room, s.regime_neutral, s.is_principal,
             s.modes, s.quality, s.diagram_data, s.created_at, s.created_by_email, s.created_by_name,
             s.category_id,
             sc.name as category_name,
             sc.color as category_color,
             (s.photo IS NOT NULL) as has_photo,
             COALESCE(s.device_count, 0) as device_count,
             COALESCE(s.complete_count, 0) as complete_count,
             COALESCE((SELECT COUNT(*) FROM switchboard_photos sp WHERE sp.switchboard_id = s.id), 0) as photos_count
      FROM switchboards s
      LEFT JOIN switchboard_categories sc ON s.category_id = sc.id
      WHERE ${where.map(w => w.replace(/\b(id|site|name|code|building_code|floor|room)\b/g, 's.$1')).join(' AND ')}
      ORDER BY ${sortSafe(sort).replace(/^(id|name|code|created_at)$/, 's.$1')} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const { rows } = await query(sql, vals, { label: 'LIST_BOARDS', timeout: 8000 });

    // Count total (rapide avec index)
    const countRes = await quickQuery(`SELECT COUNT(*)::int AS total FROM switchboards WHERE ${where.join(' AND ')}`, vals);

    const data = rows.map(r => ({
      id: r.id,
      meta: { site: r.site, building_code: r.building_code, floor: r.floor, room: r.room },
      name: r.name,
      code: r.code,
      regime_neutral: r.regime_neutral,
      is_principal: r.is_principal,
      category_id: r.category_id,
      category_name: r.category_name,
      category_color: r.category_color,
      has_photo: r.has_photo,
      photos_count: parseInt(r.photos_count, 10) || 0,
      diagram_data: r.diagram_data || {},
      modes: r.modes || {},
      quality: r.quality || {},
      created_at: r.created_at,
      created_by_email: r.created_by_email,
      created_by_name: r.created_by_name,
      // COUNTS INCLUS DIRECTEMENT - Plus besoin d'appel séparé!
      device_count: r.device_count,
      complete_count: r.complete_count
    }));
    
    res.json({ data, total: countRes.rows[0].total, page: Number(page), pageSize: limit });
  } catch (e) {
    console.error('[LIST BOARDS]', e.message);
    res.status(500).json({ error: 'List failed', details: e.message });
  }
});

// GET /boards/:id
app.get('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    const r = await quickQuery(
      `SELECT s.id, s.site, s.name, s.code, s.building_code, s.floor, s.room, s.regime_neutral, s.is_principal,
              s.modes, s.quality, s.diagram_data, s.created_at, s.created_by_email, s.created_by_name,
              s.category_id,
              sc.name as category_name,
              sc.color as category_color,
              (s.photo IS NOT NULL) as has_photo,
              COALESCE(s.device_count, 0) as device_count,
              COALESCE(s.complete_count, 0) as complete_count,
              COALESCE((SELECT COUNT(*) FROM switchboard_photos sp WHERE sp.switchboard_id = s.id), 0) as photos_count
       FROM switchboards s
       LEFT JOIN switchboard_categories sc ON s.category_id = sc.id
       WHERE s.id=$1 AND s.site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Board not found' });
    const sb = r.rows[0];

    // Get upstream sources (what feeds this board) - include full device info for selectivity analysis
    const upstream = await quickQuery(
      `SELECT d.id, d.name, d.position_number, d.in_amps, d.icu_ka,
              d.reference, d.manufacturer, d.settings,
              s.id as source_switchboard_id,
              s.name as source_board_name,
              s.code as source_board_code
       FROM devices d
       JOIN switchboards s ON d.switchboard_id = s.id
       WHERE d.downstream_switchboard_id = $1`, [id]
    );

    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name,
      code: sb.code,
      regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal,
      category_id: sb.category_id,
      category_name: sb.category_name,
      category_color: sb.category_color,
      has_photo: sb.has_photo,
      photos_count: parseInt(sb.photos_count, 10) || 0,
      diagram_data: sb.diagram_data || {},
      upstream_sources: upstream.rows,
      modes: sb.modes || {},
      quality: sb.quality || {},
      created_at: sb.created_at,
      created_by_email: sb.created_by_email,
      created_by_name: sb.created_by_name,
      device_count: sb.device_count,
      complete_count: sb.complete_count
    });
  } catch (e) {
    console.error('[GET BOARD]', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

// POST /boards - Create
app.post('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const u = getUser(req);
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const categoryId = b?.category_id ? Number(b.category_id) : null;
    const r = await quickQuery(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, category_id, modes, quality, diagram_data, device_count, complete_count, created_by_email, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, $13, $14)
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, category_id, modes, quality, diagram_data, created_at, device_count, complete_count, created_by_email, created_by_name`,
      [site, name, code, b?.meta?.building_code || null, b?.meta?.floor || null, b?.meta?.room || null,
       b?.regime_neutral || null, !!b?.is_principal, categoryId, b?.modes || {}, b?.quality || {}, b?.diagram_data || {},
       u.email || null, u.name || null]
    );
    const sb = r.rows[0];

    // 📝 AUDIT: Log création tableau
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: 'switchboard',
      entityId: sb.id,
      details: { name: sb.name, code: sb.code, site, building: sb.building_code }
    });

    // 🔔 Push notification for new switchboard
    const userId = req.user?.id || req.user?.email || req.headers['x-user-id'];
    notifyEquipmentCreated('switchboard', sb, userId).catch(err => console.log('[SWITCHBOARD] Push notify error:', err.message));

    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      category_id: sb.category_id,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data,
      created_at: sb.created_at,
      created_by_email: sb.created_by_email,
      created_by_name: sb.created_by_name,
      device_count: 0, complete_count: 0
    });
  } catch (e) {
    console.error('[CREATE BOARD]', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// PUT /boards/:id - Update - VERSION 3.0 ROBUSTE
app.put('/api/switchboard/boards/:id', async (req, res) => {
  const startTime = Date.now();
  const MAX_TIMEOUT = 12000; // 12s max total (client a 60s, on veut répondre avant)

  // Protection: si la requête est déjà fermée, ne rien faire
  if (res.headersSent || req.socket?.destroyed) {
    console.warn('[UPDATE BOARD] Request already closed, aborting');
    return;
  }

  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    const b = req.body;

    if (!b || typeof b !== 'object') {
      return res.status(400).json({ error: 'Request body must be an object' });
    }
    if (Object.keys(b).length === 0) {
      return res.status(400).json({ error: 'Request body is empty' });
    }

    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!code) return res.status(400).json({ error: 'Missing code' });

    // Handle category_id - allow setting to null by passing null or 0
    const categoryId = b?.category_id === null || b?.category_id === 0 ? null : (b?.category_id ? Number(b.category_id) : undefined);

    // Build dynamic SET clause for category_id
    let categoryClause = '';
    let params = [name, code, b?.meta?.building_code || null, b?.meta?.floor || null, b?.meta?.room || null,
       b?.regime_neutral || null, !!b?.is_principal, b?.modes || {}, b?.quality || {}, b?.diagram_data || {}];

    if (categoryId !== undefined) {
      // categoryId is explicitly set (either a number or null)
      categoryClause = ', category_id = $11';
      params.push(categoryId);
      params.push(id);  // $12
      params.push(site); // $13
    } else {
      // categoryId not provided, don't update it
      params.push(id);  // $11
      params.push(site); // $12
    }

    const whereParamId = categoryId !== undefined ? 12 : 11;
    const whereParamSite = categoryId !== undefined ? 13 : 12;

    const sqlQuery = `UPDATE switchboards SET
        name=$1, code=$2, building_code=$3, floor=$4, room=$5,
        regime_neutral=$6, is_principal=$7, modes=$8, quality=$9, diagram_data=$10${categoryClause}
      WHERE id=$${whereParamId} AND site=$${whereParamSite}
      RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, category_id,
                modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo,
                device_count, complete_count`;

    // ✅ quickQuery avec retry intégré (timeout 10s, 1 retry)
    const r = await quickQuery(
      sqlQuery,
      params,
      10000, // 10s timeout SQL
      1      // 1 retry si erreur transitoire
    );

    if (!r.rows.length) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const sb = r.rows[0];

    // 📝 AUDIT: Log modification tableau
    try {
      await audit.log(req, AUDIT_ACTIONS.UPDATED, {
        entityType: 'switchboard',
        entityId: sb.id,
        details: {
          name: sb.name,
          code: sb.code,
          site,
          building: sb.building_code,
          floor: sb.floor,
          room: sb.room,
          regime_neutral: sb.regime_neutral,
          is_principal: sb.is_principal
        }
      });
    } catch (auditErr) {
      console.warn('[UPDATE BOARD] Audit log failed (non-blocking):', auditErr.message);
    }

    // 🔔 Push notification for updated switchboard
    try {
      const userId = req.user?.id || req.user?.email || req.headers['x-user-id'];
      notify('📝 Tableau modifié', `${sb.name} (${sb.code}) a été mis à jour`, {
        type: 'equipment_updated',
        tag: `switchboard-updated-${sb.id}`,
        data: { equipmentType: 'switchboard', equipmentId: sb.id, url: `/app/switchboards?board=${sb.id}` }
      }).catch(err => console.log('[SWITCHBOARD] Push notify error:', err.message));
    } catch (notifyErr) {
      console.warn('[UPDATE BOARD] Push notify failed (non-blocking):', notifyErr.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[UPDATE BOARD] Completed in ${elapsed}ms for id=${id}`);

    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: sb.has_photo,
      category_id: sb.category_id,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data,
      created_at: sb.created_at,
      device_count: sb.device_count, complete_count: sb.complete_count
    });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`[UPDATE BOARD] Error after ${elapsed}ms:`, e.message);

    // Ne pas répondre si la connexion est déjà fermée
    if (res.headersSent || req.socket?.destroyed) {
      console.warn('[UPDATE BOARD] Cannot send error response - connection closed');
      return;
    }

    if (e.message?.includes('timeout') || e.message?.includes('canceling') || e.message?.includes('acquire')) {
      res.status(504).json({
        error: 'Timeout - réessayez dans quelques secondes',
        details: e.message,
        elapsed_ms: elapsed
      });
    } else {
      res.status(500).json({
        error: 'Update failed',
        details: e.message,
        elapsed_ms: elapsed
      });
    }
  }
});

// PATCH /boards/:id - Update partiel (diagram_data, modes, quality)
app.patch('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });
    
    const b = req.body || {};
    const updates = [];
    const values = [];
    let idx = 1;
    
    // Seuls certains champs sont patchables
    if (b.diagram_data !== undefined) {
      updates.push(`diagram_data = $${idx++}`);
      values.push(b.diagram_data);
    }
    if (b.modes !== undefined) {
      updates.push(`modes = $${idx++}`);
      values.push(b.modes);
    }
    if (b.quality !== undefined) {
      updates.push(`quality = $${idx++}`);
      values.push(b.quality);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No patchable fields provided' });
    }
    
    values.push(id, site);
    
    const r = await quickQuery(
      `UPDATE switchboards SET ${updates.join(', ')} WHERE id = $${idx++} AND site = $${idx} RETURNING id`,
      values,
      10000
    );
    
    if (!r.rows.length) return res.status(404).json({ error: 'Board not found' });

    // 📝 AUDIT: Log modification partielle tableau
    try {
      const patchedFields = [];
      if (b.diagram_data !== undefined) patchedFields.push('diagram_data');
      if (b.modes !== undefined) patchedFields.push('modes');
      if (b.quality !== undefined) patchedFields.push('quality');

      await audit.log(req, AUDIT_ACTIONS.UPDATED, {
        entityType: 'switchboard',
        entityId: id,
        details: {
          patchType: 'partial',
          fieldsUpdated: patchedFields,
          site
        }
      });
    } catch (auditErr) {
      console.warn('[PATCH BOARD] Audit log failed (non-blocking):', auditErr.message);
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error('[PATCH BOARD]', e.message);
    res.status(500).json({ error: 'Patch failed' });
  }
});

// DELETE /boards/:id
app.delete('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    // Get board info before delete (for audit)
    const countRes = await quickQuery(`SELECT device_count, name, code FROM switchboards WHERE id = $1 AND site = $2`, [id, site]);
    const boardInfo = countRes.rows[0];
    const deviceCount = boardInfo?.device_count || 0;

    const r = await quickQuery(`DELETE FROM switchboards WHERE id=$1 AND site=$2 RETURNING id, name`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Board not found' });

    // 🧹 Cleanup orphaned positions and equipment links
    const posResult = await quickQuery(`DELETE FROM switchboard_positions WHERE switchboard_id = $1 AND site = $2`, [id, site]);
    const linksResult = await quickQuery(`
      DELETE FROM equipment_links
      WHERE site = $1
      AND (
        (source_type = 'switchboard' AND source_id = $2)
        OR (target_type = 'switchboard' AND target_id = $2)
      )
    `, [site, String(id)]);
    console.log(`[DELETE BOARD] Cleaned up ${posResult.rowCount} positions and ${linksResult.rowCount} equipment links for switchboard ${id}`);

    // 📝 AUDIT: Log suppression tableau
    await audit.log(req, AUDIT_ACTIONS.DELETED, {
      entityType: 'switchboard',
      entityId: id,
      details: { name: boardInfo?.name, code: boardInfo?.code, site, devicesDeleted: deviceCount }
    });

    // 🔔 Push notification for deleted switchboard
    if (boardInfo) {
      const userId = req.user?.id || req.user?.email || req.headers['x-user-id'];
      notifyEquipmentDeleted('switchboard', boardInfo, userId).catch(err => console.log('[SWITCHBOARD] Push notify error:', err.message));
    }

    res.json({ success: true, deleted: id, name: r.rows[0].name, devices_deleted: deviceCount });
  } catch (e) {
    console.error('[DELETE BOARD]', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// POST /boards/:id/duplicate
app.post('/api/switchboard/boards/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });
    
    const r = await quickQuery(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, device_count, complete_count)
       SELECT site, name || ' (copy)', code || '_COPY', building_code, floor, room, regime_neutral, FALSE, modes, quality, diagram_data, 0, 0
       FROM switchboards WHERE id=$1 AND site=$2
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, created_at`,
      [id, site]
    );
    
    if (!r.rows.length) return res.status(404).json({ error: 'Board not found' });

    const sb = r.rows[0];

    // 📝 AUDIT: Log duplication tableau
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: 'switchboard',
      entityId: sb.id,
      details: {
        name: sb.name,
        code: sb.code,
        action: 'duplicated',
        source_id: id,
        site
      }
    });

    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data,
      created_at: sb.created_at,
      device_count: 0, complete_count: 0
    });
  } catch (e) {
    console.error('[DUPLICATE BOARD]', e.message);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// ============================================================
// SWITCHBOARD PHOTO
// ============================================================

app.post('/api/switchboard/boards/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const r = await quickQuery(
      `UPDATE switchboards SET photo = $1 WHERE id = $2 AND site = $3 RETURNING id`,
      [req.file.buffer, id, site],
      10000 // 10s pour l'upload
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Board not found' });
    
    res.json({ success: true, id });
  } catch (e) {
    console.error('[BOARD PHOTO UPLOAD]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/switchboard/boards/:id/photo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    const r = await quickQuery(`SELECT photo FROM switchboards WHERE id = $1 AND site = $2`, [id, site]);
    if (!r.rows.length || !r.rows[0].photo) return res.status(404).json({ error: 'Photo not found' });

    res.set('Content-Type', 'image/jpeg');
    // Cache la photo pendant 1 heure - évite les recharges inutiles
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].photo);
  } catch (e) {
    console.error('[BOARD PHOTO GET]', e.message);
    res.status(500).json({ error: 'Get photo failed' });
  }
});

// ============================================================
// SWITCHBOARD CATEGORIES CRUD
// ============================================================

// GET /api/switchboard/categories - List all categories
app.get('/api/switchboard/categories', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { rows } = await quickQuery(`
      SELECT c.*,
             (SELECT COUNT(*) FROM switchboards s WHERE s.category_id = c.id AND s.site = c.site) as switchboard_count
        FROM switchboard_categories c
       WHERE c.site = $1
       ORDER BY c.sort_order, c.name
    `, [site]);

    res.json({ ok: true, categories: rows });
  } catch (e) {
    console.error('[SWITCHBOARD CATEGORIES] List error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/switchboard/categories - Create category
app.post('/api/switchboard/categories', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { name, description, color, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Name required' });

    const { rows } = await quickQuery(`
      INSERT INTO switchboard_categories (site, name, description, color, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [site, name.trim(), description || null, color || '#F59E0B', sort_order || 0]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, { entityType: 'switchboard_category', entityId: rows[0].id, details: { name } });
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    console.error('[SWITCHBOARD CATEGORIES] Create error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/switchboard/categories/:id - Update category
app.put('/api/switchboard/categories/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    const { name, description, color, sort_order } = req.body;

    const { rows } = await quickQuery(`
      UPDATE switchboard_categories
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             color = COALESCE($3, color),
             sort_order = COALESCE($4, sort_order)
       WHERE id = $5 AND site = $6
       RETURNING *
    `, [name, description, color, sort_order, id, site]);

    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Category not found' });

    await audit.log(req, AUDIT_ACTIONS.UPDATED, { entityType: 'switchboard_category', entityId: id, details: { name } });
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    console.error('[SWITCHBOARD CATEGORIES] Update error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/switchboard/categories/:id - Delete category
app.delete('/api/switchboard/categories/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    const { rowCount } = await quickQuery(`DELETE FROM switchboard_categories WHERE id = $1 AND site = $2`, [id, site]);

    if (rowCount === 0) return res.status(404).json({ ok: false, error: 'Category not found' });

    await audit.log(req, AUDIT_ACTIONS.DELETED, { entityType: 'switchboard_category', entityId: id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[SWITCHBOARD CATEGORIES] Delete error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// SWITCHBOARD PHOTOS GALLERY
// ============================================================

// GET /api/switchboard/boards/:id/photos - Liste des photos de la galerie
app.get('/api/switchboard/boards/:id/photos', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    const { rows } = await quickQuery(`
      SELECT id, source, description, created_at, created_by
      FROM switchboard_photos
      WHERE switchboard_id = $1 AND site = $2
      ORDER BY created_at DESC
    `, [id, site]);

    res.json({ photos: rows });
  } catch (e) {
    console.error('[BOARD PHOTOS LIST]', e.message);
    res.status(500).json({ error: 'Failed to get photos' });
  }
});

// GET /api/switchboard/boards/:id/photos/:photoId - Récupérer une photo spécifique
app.get('/api/switchboard/boards/:id/photos/:photoId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    const photoId = Number(req.params.photoId);
    if (!id || isNaN(id) || !photoId || isNaN(photoId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const { rows } = await quickQuery(`
      SELECT photo FROM switchboard_photos
      WHERE id = $1 AND switchboard_id = $2 AND site = $3
    `, [photoId, id, site]);

    if (!rows.length || !rows[0].photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(rows[0].photo);
  } catch (e) {
    console.error('[BOARD PHOTO GET]', e.message);
    res.status(500).json({ error: 'Failed to get photo' });
  }
});

// POST /api/switchboard/boards/:id/photos - Ajouter une photo à la galerie
app.post('/api/switchboard/boards/:id/photos', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const user = await currentUser(req);
    const source = req.body.source || 'manual';
    const description = req.body.description || null;

    const { rows } = await quickQuery(`
      INSERT INTO switchboard_photos (site, switchboard_id, photo, source, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, source, description, created_at
    `, [site, id, req.file.buffer, source, description, user?.email]);

    res.json({ success: true, photo: rows[0] });
  } catch (e) {
    console.error('[BOARD PHOTO ADD]', e.message);
    res.status(500).json({ error: 'Failed to add photo' });
  }
});

// DELETE /api/switchboard/boards/:id/photos/:photoId - Supprimer une photo
app.delete('/api/switchboard/boards/:id/photos/:photoId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    const photoId = Number(req.params.photoId);
    if (!id || isNaN(id) || !photoId || isNaN(photoId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const { rowCount } = await quickQuery(`
      DELETE FROM switchboard_photos
      WHERE id = $1 AND switchboard_id = $2 AND site = $3
    `, [photoId, id, site]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[BOARD PHOTO DELETE]', e.message);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// ============================================================
// DEVICE COUNTS - LEGACY ENDPOINT (pour compatibilité)
// Maintenant optimisé avec fallback gracieux
// ============================================================

app.post('/api/switchboard/devices-count', async (req, res) => {
  const startTime = Date.now();
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const boardIds = req.body?.board_ids;
    
    // Fast path
    if (!boardIds || !Array.isArray(boardIds) || boardIds.length === 0) {
      return res.json({ counts: {} });
    }

    const ids = boardIds.map(Number).filter(id => id && !isNaN(id));
    if (!ids.length) return res.json({ counts: {} });

    // MÉTHODE OPTIMISÉE: Lire depuis la table switchboards (colonnes cache)
    const { rows } = await quickQuery(`
      SELECT id, 
             COALESCE(device_count, 0) as total,
             COALESCE(complete_count, 0) as complete
      FROM switchboards
      WHERE id = ANY($1::int[]) AND site = $2
    `, [ids, site], 5000);
    
    const counts = {};
    rows.forEach(r => {
      counts[r.id] = { total: r.total, complete: r.complete };
    });
    
    // Fill zeros for missing IDs
    ids.forEach(id => {
      if (!counts[id]) counts[id] = { total: 0, complete: 0 };
    });
    
    const elapsed = Date.now() - startTime;
    if (elapsed > 1000) {
      console.warn(`[DEVICES COUNT] Took ${elapsed}ms for ${ids.length} boards`);
    }
    
    res.json({ counts });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`[DEVICES COUNT] Error after ${elapsed}ms:`, e.message);
    // Graceful fallback - return empty instead of error
    res.json({ counts: {}, error: e.message, partial: true });
  }
});

// ============================================================
// DEVICES CRUD
// ============================================================

// GET /boards/:boardId/devices
app.get('/api/switchboard/boards/:boardId/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const switchboard_id = Number(req.params.boardId);
    if (!switchboard_id || isNaN(switchboard_id)) {
      return res.status(400).json({ error: 'Invalid switchboard ID' });
    }

    // Verify board exists
    const sbCheck = await quickQuery('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await query(
      `SELECT d.id, d.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
              d.name, d.device_type, d.manufacturer, d.reference,
              d.in_amps, d.icu_ka, d.ics_ka, d.poles, d.voltage_v, d.trip_unit,
              d.position_number, d.is_differential, d.is_complete, d.settings,
              d.is_main_incoming, d.diagram_data, d.created_at, d.updated_at,
              d.curve_type, d.differential_sensitivity_ma, d.differential_type,
              d.created_by_email, d.created_by_name,
              sb_down.name as downstream_switchboard_name,
              sb_down.code as downstream_switchboard_code
       FROM devices d
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.switchboard_id = $1
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`,
      [switchboard_id], { label: 'LIST_DEVICES', timeout: 8000 }
    );
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[LIST DEVICES]', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// GET /devices/:id
app.get('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid device ID' });

    // 🔧 Exclure photos BYTEA[] et pv_tests BYTEA pour éviter latence
    const r = await quickQuery(
      `SELECT d.id, d.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id, d.name,
              d.device_type, d.manufacturer, d.reference, d.in_amps, d.icu_ka, d.ics_ka, d.poles,
              d.voltage_v, d.trip_unit, d.position_number, d.is_differential, d.is_complete,
              d.settings, d.is_main_incoming, d.diagram_data, d.created_at, d.updated_at,
              d.created_by_email, d.created_by_name,
              COALESCE(array_length(d.photos, 1), 0) AS photos_count,
              (d.pv_tests IS NOT NULL) AS has_pv_tests,
              s.name as switchboard_name, s.code as switchboard_code,
              sb_down.name as downstream_switchboard_name, sb_down.code as downstream_switchboard_code
       FROM devices d
       JOIN switchboards s ON d.switchboard_id = s.id
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.id = $1 AND s.site = $2`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Device not found' });
    
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[GET DEVICE]', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

// POST /devices - Create
app.post('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const u = getUser(req);
    const b = req.body || {};
    const switchboard_id = Number(b.switchboard_id);

    if (!switchboard_id || isNaN(switchboard_id)) {
      return res.status(400).json({ error: 'Missing or invalid switchboard_id' });
    }

    // Verify board exists
    const sbCheck = await quickQuery('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const is_complete = checkDeviceComplete(b);

    const { rows } = await quickQuery(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id,
        name, device_type, manufacturer, reference,
        in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
        curve_type, differential_sensitivity_ma, differential_type,
        position_number, is_differential, is_complete, settings, is_main_incoming, diagram_data,
        created_by_email, created_by_name
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       RETURNING *`,
      [
        site, switchboard_id,
        b.parent_id || null,
        b.downstream_switchboard_id || null,
        b.name || null,
        b.device_type || 'Low Voltage Circuit Breaker',
        b.manufacturer || null,
        b.reference || null,
        b.in_amps ? Number(b.in_amps) : null,
        b.icu_ka ? Number(b.icu_ka) : null,
        b.ics_ka ? Number(b.ics_ka) : null,
        b.poles ? Number(b.poles) : null,
        b.voltage_v ? Number(b.voltage_v) : null,
        b.trip_unit || null,
        b.curve_type || null,
        b.differential_sensitivity_ma ? Number(b.differential_sensitivity_ma) : null,
        b.differential_type || null,
        b.position_number || null,
        !!b.is_differential,
        is_complete,
        b.settings || {},
        !!b.is_main_incoming,
        b.diagram_data || {},
        u.email || null,
        u.name || null
      ]
    );

    const device = rows[0];

    // 📝 AUDIT: Log création appareil
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: 'device',
      entityId: device.id,
      details: {
        name: device.name,
        deviceType: device.device_type,
        switchboardId: switchboard_id,
        manufacturer: device.manufacturer,
        reference: device.reference,
        inAmps: device.in_amps
      }
    });

    // 🔔 Push notification for new device
    const userId = req.user?.id || req.user?.email || req.headers['x-user-id'];
    notifyEquipmentCreated('device', { ...device, switchboard_id: switchboard_id }, userId).catch(err => console.log('[SWITCHBOARD] Device push notify error:', err.message));

    // Le trigger met à jour automatiquement device_count et complete_count

    res.status(201).json(device);
  } catch (e) {
    console.error('[CREATE DEVICE]', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// PUT /devices/:id - Update - VERSION 3.0 ROBUSTE
app.put('/api/switchboard/devices/:id', async (req, res) => {
  const startTime = Date.now();

  // Protection: si la requête est déjà fermée, ne rien faire
  if (res.headersSent || req.socket?.destroyed) {
    console.warn('[UPDATE DEVICE] Request already closed, aborting');
    return;
  }

  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid device ID' });

    const b = req.body;
    if (!b || typeof b !== 'object') {
      console.warn('[UPDATE DEVICE] Invalid body type for id:', id);
      return res.status(400).json({ error: 'Request body must be an object' });
    }
    if (Object.keys(b).length === 0) {
      console.warn('[UPDATE DEVICE] Empty body for id:', id);
      return res.status(400).json({ error: 'Request body is empty' });
    }

    const is_complete = checkDeviceComplete(b);

    console.log(`[UPDATE DEVICE] Starting update for id=${id}, site=${site}`);

    // ✅ quickQuery avec retry intégré (timeout 10s, 1 retry)
    const result = await quickQuery(
      `UPDATE devices SET
         parent_id = $1, downstream_switchboard_id = $2, name = $3, device_type = $4,
         manufacturer = $5, reference = $6, in_amps = $7, icu_ka = $8, ics_ka = $9,
         poles = $10, voltage_v = $11, trip_unit = $12, position_number = $13,
         is_differential = $14, is_complete = $15, settings = $16, is_main_incoming = $17,
         diagram_data = $18, curve_type = $19, differential_sensitivity_ma = $20,
         differential_type = $21, updated_at = NOW()
       FROM switchboards sb
       WHERE devices.id = $22 AND devices.switchboard_id = sb.id AND sb.site = $23
       RETURNING devices.*`,
      [
        b.parent_id || null,
        b.downstream_switchboard_id || null,
        b.name || null,
        b.device_type || 'Low Voltage Circuit Breaker',
        b.manufacturer || null,
        b.reference || null,
        b.in_amps ? Number(b.in_amps) : null,
        b.icu_ka ? Number(b.icu_ka) : null,
        b.ics_ka ? Number(b.ics_ka) : null,
        b.poles ? Number(b.poles) : null,
        b.voltage_v ? Number(b.voltage_v) : null,
        b.trip_unit || null,
        b.position_number || null,
        !!b.is_differential,
        is_complete,
        b.settings || {},
        !!b.is_main_incoming,
        b.diagram_data || {},
        b.curve_type || null,
        b.differential_sensitivity_ma ? Number(b.differential_sensitivity_ma) : null,
        b.differential_type || null,
        id,
        site
      ],
      10000, // 10s timeout SQL
      1      // 1 retry si erreur transitoire
    );

    const rows = result.rows || [];
    if (!rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = rows[0];

    // 📝 AUDIT: Log modification appareil
    try {
      await audit.log(req, AUDIT_ACTIONS.UPDATED, {
        entityType: 'device',
        entityId: device.id,
        details: {
          name: device.name,
          deviceType: device.device_type,
          switchboardId: device.switchboard_id,
          manufacturer: device.manufacturer,
          reference: device.reference,
          inAmps: device.in_amps,
          site
        }
      });
    } catch (auditErr) {
      console.warn('[UPDATE DEVICE] Audit log failed (non-blocking):', auditErr.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[UPDATE DEVICE] Completed in ${elapsed}ms for id=${id}`);

    res.json(device);
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`[UPDATE DEVICE] Error after ${elapsed}ms:`, e.message);

    // Ne pas répondre si la connexion est déjà fermée
    if (res.headersSent || req.socket?.destroyed) {
      console.warn('[UPDATE DEVICE] Cannot send error response - connection closed');
      return;
    }

    if (e.message?.includes('timeout') || e.message?.includes('canceling') || e.message?.includes('acquire')) {
      res.status(504).json({
        error: 'Timeout - réessayez dans quelques secondes',
        details: e.message,
        elapsed_ms: elapsed
      });
    } else {
      res.status(500).json({
        error: 'Update failed',
        details: e.message,
        elapsed_ms: elapsed
      });
    }
  }
});

// DELETE /devices/:id
app.delete('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid device ID' });

    // Get device info before delete (for audit)
    const deviceInfo = await quickQuery(
      `SELECT d.name, d.device_type, d.manufacturer, d.reference, d.switchboard_id, sb.name as board_name
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.id = $1 AND sb.site = $2`,
      [id, site]
    );

    const r = await quickQuery(
      `DELETE FROM devices d
       USING switchboards sb
       WHERE d.id = $1 AND d.switchboard_id = sb.id AND sb.site = $2
       RETURNING d.id, d.switchboard_id`,
      [id, site]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: 'Device not found' });

    // 📝 AUDIT: Log suppression appareil
    const dev = deviceInfo.rows[0];
    await audit.log(req, AUDIT_ACTIONS.DELETED, {
      entityType: 'device',
      entityId: id,
      details: {
        name: dev?.name,
        deviceType: dev?.device_type,
        switchboardId: dev?.switchboard_id,
        boardName: dev?.board_name,
        manufacturer: dev?.manufacturer,
        reference: dev?.reference
      }
    });

    // 🔔 Push notification for deleted device
    if (dev) {
      const userId = req.user?.id || req.user?.email || req.headers['x-user-id'];
      notifyEquipmentDeleted('device', dev, userId).catch(err => console.log('[SWITCHBOARD] Device push notify error:', err.message));
    }

    // Le trigger met à jour automatiquement device_count et complete_count

    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DELETE DEVICE]', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// PUT /boards/:boardId/devices/bulk-positions - Mise à jour en bulk des positions
app.put('/api/switchboard/boards/:boardId/devices/bulk-positions', async (req, res) => {
  const startTime = Date.now();
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const boardId = Number(req.params.boardId);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });

    const { devices } = req.body || {};
    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'devices array required' });
    }

    // Vérifier que le board existe
    const boardCheck = await quickQuery('SELECT id FROM switchboards WHERE id = $1 AND site = $2', [boardId, site]);
    if (!boardCheck.rows.length) return res.status(404).json({ error: 'Board not found' });

    // Construire la requête bulk avec CASE WHEN
    const ids = [];
    const positionCases = [];
    
    devices.forEach((d, idx) => {
      const deviceId = Number(d.id);
      if (!deviceId || isNaN(deviceId)) return;
      
      ids.push(deviceId);
      // Stocker la position dans diagram_data (JSON)
      const posJson = JSON.stringify(d.position || { x: 0, y: 0 });
      positionCases.push(`WHEN id = ${deviceId} THEN '${posJson.replace(/'/g, "''")}'::jsonb`);
    });

    if (ids.length === 0) {
      return res.status(400).json({ error: 'No valid device IDs' });
    }

    // Update en une seule requête
    const sql = `
      UPDATE devices 
      SET diagram_data = CASE ${positionCases.join(' ')} ELSE diagram_data END,
          updated_at = NOW()
      WHERE id = ANY($1::int[]) 
        AND switchboard_id = $2
      RETURNING id
    `;

    const result = await quickQuery(sql, [ids, boardId], 45000);

    const elapsed = Date.now() - startTime;
    console.log(`[BULK POSITIONS] Updated ${result.rowCount} devices in ${elapsed}ms`);

    // 📝 AUDIT: Log mise à jour positions en masse
    if (result.rowCount > 0) {
      await audit.log(req, AUDIT_ACTIONS.UPDATED, {
        entityType: 'devices',
        entityId: boardId,
        details: {
          action: 'bulk_positions',
          devices_updated: result.rowCount,
          site
        }
      });
    }

    res.json({
      success: true,
      updated: result.rowCount,
      elapsed_ms: elapsed
    });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`[BULK POSITIONS] Error after ${elapsed}ms:`, e.message);
    
    if (e.message?.includes('timeout') || e.message?.includes('canceling')) {
      res.status(504).json({ error: 'Database timeout', details: e.message });
    } else {
      res.status(500).json({ error: 'Bulk update failed', details: e.message });
    }
  }
});

// ============================================================
// EXCEL IMPORT
// ============================================================

app.post('/api/switchboard/import-excel', upload.single('file'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    console.log(`[EXCEL IMPORT] File: ${req.file.originalname}, size: ${req.file.buffer.length}`);

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });
    } catch (parseErr) {
      return res.status(400).json({ error: `Invalid file format: ${parseErr.message}` });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'No worksheet found' });
    
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    if (!data || data.length < 12) {
      return res.status(400).json({ error: 'Excel file too short (less than 12 rows)' });
    }

    const getCellValue = (rowIndex, colIndex) => {
      if (!data[rowIndex]) return '';
      const val = data[rowIndex][colIndex];
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      return String(val).trim();
    };

    // Extract board name and code
    let tableauName = 'Tableau importé';
    for (let col = 3; col <= 6; col++) {
      const val = getCellValue(1, col);
      if (val && val.length > 2) { tableauName = val; break; }
    }

    let code = `IMP-${Date.now()}`;
    for (let col = 3; col <= 6; col++) {
      const val = getCellValue(3, col);
      if (val && val.length > 2) { code = val; break; }
    }

    const codeParts = code.split('-');
    const building = codeParts[0] || null;
    const floor = codeParts[1] || null;

    // Check if board already exists
    const existingBoard = await quickQuery(
      `SELECT id, name, code, device_count FROM switchboards WHERE site = $1 AND LOWER(code) = LOWER($2)`,
      [site, code]
    );

    let switchboardId;
    let boardAlreadyExists = false;
    let existingDeviceCount = 0;

    if (existingBoard.rows.length > 0) {
      boardAlreadyExists = true;
      switchboardId = existingBoard.rows[0].id;
      existingDeviceCount = existingBoard.rows[0].device_count || 0;
      
      // Update name if different
      if (existingBoard.rows[0].name !== tableauName) {
        await quickQuery(
          `UPDATE switchboards SET name = $1, building_code = $2, floor = $3 WHERE id = $4`,
          [tableauName, building, floor, switchboardId]
        );
      }
    } else {
      const newBoard = await quickQuery(
        `INSERT INTO switchboards (site, name, code, building_code, floor, regime_neutral, device_count, complete_count)
         VALUES ($1, $2, $3, $4, $5, 'TN-S', 0, 0) RETURNING id`,
        [site, tableauName, code, building, floor]
      );
      switchboardId = newBoard.rows[0].id;
    }

    // Validation helpers
    const EXCLUDED_KEYWORDS = [
      'modifié', 'modified', 'date', 'nom', 'name', 'société', 'company', 
      'visa', 'maintenance', 'signature', 'revision', 'révision', 'version'
    ];

    const isValidPosition = (pos) => {
      if (!pos) return false;
      const str = String(pos).trim();
      if (!str) return false;
      if (/^\d+(\.\d+)?$/.test(str)) return true;
      if (/^[A-Za-z]?\d+[A-Za-z]?$/.test(str)) return true;
      if (/^[A-Za-z0-9]+$/.test(str) && /\d/.test(str) && str.length <= 15) return true;
      if (/^[A-Za-z0-9][-.\dA-Za-z]*\d[-.\dA-Za-z]*$/.test(str) && str.length <= 15) return true;
      return false;
    };

    const isMetadataRow = (rowData) => {
      const cellValues = (rowData || []).map(v => String(v || '').toLowerCase().trim()).filter(Boolean);
      for (const cellVal of cellValues) {
        for (const keyword of EXCLUDED_KEYWORDS) {
          if (cellVal.includes(keyword)) return true;
        }
      }
      return false;
    };

    // Get existing positions to avoid duplicates
    const existingPositions = new Set();
    if (boardAlreadyExists) {
      const posRes = await quickQuery(
        `SELECT position_number FROM devices WHERE switchboard_id = $1 AND position_number IS NOT NULL`,
        [switchboardId]
      );
      posRes.rows.forEach(r => existingPositions.add(String(r.position_number).toLowerCase()));
    }

    // Parse and insert devices
    let devicesCreated = 0;
    let devicesSkipped = 0;
    let consecutiveEmptyRows = 0;
    const MAX_EMPTY_ROWS = 3;

    for (let rowIndex = 11; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      if (!row) continue;

      const position = getCellValue(rowIndex, 0);
      
      let designation = '';
      for (let col = 1; col <= 4; col++) {
        const val = getCellValue(rowIndex, col);
        if (val && val.length > 1) { designation = val; break; }
      }

      // Skip header rows
      if (position.toLowerCase().includes('repère') || position.toLowerCase().includes('départ')) continue;

      // Check for empty rows
      if (!position && !designation) {
        consecutiveEmptyRows++;
        if (consecutiveEmptyRows >= MAX_EMPTY_ROWS) break;
        continue;
      }
      consecutiveEmptyRows = 0;

      // Skip invalid rows
      if (isMetadataRow(row) || !isValidPosition(position) || !designation) {
        devicesSkipped++;
        continue;
      }

      // Skip duplicates
      if (existingPositions.has(String(position).toLowerCase())) {
        devicesSkipped++;
        continue;
      }

      // Insert device (trigger will update counts)
      await quickQuery(
        `INSERT INTO devices (site, switchboard_id, name, device_type, position_number, is_differential, is_complete)
         VALUES ($1, $2, $3, $4, $5, false, false)`,
        [site, switchboardId, designation, 'Low Voltage Circuit Breaker', position]
      );
      
      existingPositions.add(String(position).toLowerCase());
      devicesCreated++;
    }

    console.log(`[EXCEL IMPORT] Complete: created=${devicesCreated}, skipped=${devicesSkipped}`);

    // 📝 AUDIT: Log import Excel
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: 'switchboard',
      entityId: switchboardId,
      details: {
        action: 'excel_import',
        name: tableauName,
        code,
        board_created: !boardAlreadyExists,
        devices_created: devicesCreated,
        devices_skipped: devicesSkipped,
        site
      }
    });

    res.json({
      success: true,
      already_exists: boardAlreadyExists,
      switchboard: { id: switchboardId, name: tableauName, code, building, floor },
      devices_created: devicesCreated,
      devices_skipped: devicesSkipped,
      existing_devices: existingDeviceCount,
      message: boardAlreadyExists
        ? `⚠️ Board "${code}" already exists. ${devicesCreated} new devices added.`
        : `✅ Board "${code}" created with ${devicesCreated} devices.`
    });
  } catch (e) {
    console.error('[EXCEL IMPORT]', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ============================================================
// AI PHOTO ANALYSIS - Version 2.0 (Analyse approfondie)
// ============================================================

app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!openai && !gemini) return res.status(503).json({ error: 'No AI provider available' });

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    console.log('[PHOTO ANALYSIS v2.0] Starting comprehensive analysis...');

    // ========================================
    // ÉTAPE 1: Analyse visuelle détaillée
    // ========================================
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert électricien spécialisé en identification de disjoncteurs et appareillage électrique.

FABRICANTS ET LEURS CARACTÉRISTIQUES VISUELLES:
- Hager: Bleu clair, logo "h" stylisé, références commençant par MCA, MCN, MCS, MJN
- Schneider Electric: Vert, logo SE carré, références iC60, iC40, Acti9, Compact NS
- ABB: Orange/rouge, logo ABB, références S200, S800, SACE Tmax
- Legrand: Vert foncé ou gris, logo Legrand, références DX³, DNX³, DPX³
- Siemens: Turquoise/cyan, logo Siemens, références 5SL, 5SY, 3VA
- Eaton: Rouge/noir, logo Eaton, références FAZ, PLSM, NZM
- General Electric: Noir, logo GE, références EP, EP100
- Gewiss: Bleu, logo G90, références GW92

INFORMATIONS À EXTRAIRE (lis toutes les inscriptions visibles):
1. Fabricant (couleur, logo, style)
2. Référence complète (ex: MCA320, iC60N C16, S201 B10)
3. Intensité nominale In (A) - souvent le plus gros chiffre
4. Courbe de déclenchement (B, C, D, K, Z) - lettre avant l'intensité
5. Pouvoir de coupure Icu/Icn (kA) - TRÈS IMPORTANT, cherche:
   - Inscription "Icu" ou "Icn" suivie d'un nombre en kA
   - Nombre dans un rectangle/carré suivi de "kA" (ex: "6000", "10000", "6kA", "10kA")
   - Position: souvent en bas de la face avant, parfois sur le côté
   - Formats courants: 6kA, 10kA, 15kA, 25kA, 36kA, 50kA, 70kA, 100kA
   - Peut aussi apparaître comme "6000A" (= 6kA)
6. Tension d'emploi (V) - 230V, 400V, etc.
7. Nombre de pôles - IMPORTANT: 1P=1 module, 2P/1P+N=2 modules, 3P=3 modules, 4P/3P+N=4 modules, 5P=5 modules. Compte les manettes liées!
8. Différentiel (symbole Δ ou "RCCB", "RCD", sensibilité en mA)
9. Type d'unité de déclenchement (thermique-magnétique TM, électronique)

IMPORTANT:
- Analyse TOUT le texte visible, même les petits caractères
- Le pouvoir de coupure (Icu) est CRITIQUE - cherche-le attentivement partout sur l'appareil
- Si tu vois un nombre comme 6000, 10000, 15000 avec ou sans "A" ou "kA", c'est probablement l'Icu

Réponds en JSON avec TOUS ces champs (null si non visible):
{
  "manufacturer": "...",
  "manufacturer_confidence": "high/medium/low",
  "manufacturer_clues": "couleur, logo, style observés",
  "reference": "référence complète",
  "in_amps": number ou null,
  "curve_type": "B/C/D/K/Z ou null",
  "icu_ka": number ou null,
  "ics_ka": number ou null,
  "voltage_v": number ou null,
  "poles": number (1-4),
  "is_differential": boolean,
  "differential_sensitivity_ma": number ou null si différentiel,
  "trip_unit": "thermique-magnétique/électronique/null",
  "device_type": "Disjoncteur modulaire/Disjoncteur différentiel/Interrupteur différentiel/Contacteur/autre",
  "all_visible_text": ["liste de tout le texte visible sur l'appareil"],
  "analysis_notes": "observations complémentaires"
}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyse ce disjoncteur en détail. Lis toutes les inscriptions visibles et identifie toutes les caractéristiques techniques.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
      temperature: 0.1
    });

    let result = JSON.parse(visionResponse.choices[0].message.content);
    console.log('[PHOTO ANALYSIS v2.0] Vision result:', JSON.stringify(result, null, 2));

    // ========================================
    // ÉTAPE 2: Enrichissement par recherche de spécifications
    // ========================================
    if (result.reference && result.manufacturer) {
      try {
        console.log(`[PHOTO ANALYSIS v2.0] Enriching specs for ${result.manufacturer} ${result.reference}...`);

        const specsResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Tu es un expert en documentation technique de disjoncteurs électriques avec une connaissance approfondie des catalogues fabricants.

Pour le disjoncteur ${result.manufacturer} ${result.reference}, fournis les spécifications techniques complètes basées sur tes connaissances des catalogues fabricants.

POUVOIR DE COUPURE (Icu) - CRITIQUE:
Le pouvoir de coupure Icu est OBLIGATOIRE. Voici les valeurs standards par gamme:
- Hager MCA/MCN: 6kA | MCS: 10kA
- Schneider iC60N: 6kA | iC60H: 10kA | iC60L: 25kA | Compact NSX: 25-150kA
- ABB S200: 6kA | S200M: 10kA | S800: 50kA
- Legrand DNX³: 4.5kA | DX³: 6-10kA | DPX³: 16-150kA
- Siemens 5SL: 6kA | 5SY: 10kA
- General Electric EP: 6kA | EP100: 10kA

Si tu connais la référence exacte, donne la valeur Icu précise du catalogue.
Sinon, donne la valeur standard de la gamme.

Réponds en JSON avec les spécifications enrichies:
{
  "confirmed_reference": "référence vérifiée/corrigée",
  "in_amps": number,
  "curve_type": "B/C/D",
  "icu_ka": number (OBLIGATOIRE - valeur du catalogue ou estimation basée sur la gamme),
  "ics_ka": number,
  "voltage_v": number,
  "poles": number,
  "is_differential": boolean,
  "differential_sensitivity_ma": number ou null,
  "differential_type": "AC/A/B/F ou null",
  "trip_unit": "description",
  "product_range": "gamme produit (ex: Acti9, DX³)",
  "mounting_type": "rail DIN/fixe",
  "width_modules": number,
  "specifications_source": "catalogue/documentation/estimation",
  "data_confidence": "high/medium/low"
}`
            },
            {
              role: 'user',
              content: `Disjoncteur: ${result.manufacturer} ${result.reference}
Valeurs déjà identifiées:
- Intensité: ${result.in_amps || 'non visible'}A
- Courbe: ${result.curve_type || 'non visible'}
- Icu: ${result.icu_ka || 'non visible'}kA
- Pôles: ${result.poles || 'non visible'}
- Différentiel: ${result.is_differential ? 'oui' : 'non'}

Complète les spécifications manquantes.`
            }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 800,
          temperature: 0.1
        });

        const enrichedSpecs = JSON.parse(specsResponse.choices[0].message.content);
        console.log('[PHOTO ANALYSIS v2.0] Enriched specs:', JSON.stringify(enrichedSpecs, null, 2));

        // Fusionner les résultats (priorité aux valeurs visuelles si non-null)
        result = {
          ...result,
          reference: enrichedSpecs.confirmed_reference || result.reference,
          in_amps: result.in_amps || enrichedSpecs.in_amps,
          curve_type: result.curve_type || enrichedSpecs.curve_type,
          icu_ka: result.icu_ka || enrichedSpecs.icu_ka,
          ics_ka: result.ics_ka || enrichedSpecs.ics_ka,
          voltage_v: result.voltage_v || enrichedSpecs.voltage_v,
          poles: result.poles || enrichedSpecs.poles,
          differential_sensitivity_ma: result.differential_sensitivity_ma || enrichedSpecs.differential_sensitivity_ma,
          differential_type: enrichedSpecs.differential_type,
          trip_unit: result.trip_unit || enrichedSpecs.trip_unit,
          product_range: enrichedSpecs.product_range,
          mounting_type: enrichedSpecs.mounting_type,
          width_modules: enrichedSpecs.width_modules,
          enriched: true,
          enrichment_confidence: enrichedSpecs.data_confidence
        };
      } catch (enrichError) {
        console.warn('[PHOTO ANALYSIS v2.0] Enrichment failed:', enrichError.message);
        result.enriched = false;
      }
    }

    // ========================================
    // ÉTAPE 3: Vérification cache produits scannés
    // ========================================
    let cacheResults = [];
    if (result.reference || result.manufacturer) {
      try {
        const cacheQuery = await quickQuery(`
          SELECT id, reference, manufacturer, in_amps, icu_ka, ics_ka, poles, voltage_v,
                 trip_unit, is_differential, scan_count, validated
          FROM scanned_products
          WHERE site = $1 AND (reference ILIKE $2 OR manufacturer ILIKE $3)
          ORDER BY validated DESC, scan_count DESC LIMIT 5
        `, [site, `%${result.reference || ''}%`, `%${result.manufacturer || ''}%`]);
        cacheResults = cacheQuery.rows;

        // Si un produit validé existe dans le cache, l'utiliser pour compléter
        const validatedMatch = cacheResults.find(c => c.validated &&
          c.reference?.toLowerCase() === result.reference?.toLowerCase());
        if (validatedMatch) {
          console.log('[PHOTO ANALYSIS v2.0] Found validated cache match, using cached values for Icu/voltage');
          // IMPORTANT: NE PAS utiliser le cache pour in_amps et poles !
          // Ces valeurs DOIVENT venir de l'analyse photo pour être précises
          // Le cache est utile uniquement pour icu_ka, ics_ka, voltage_v, trip_unit
          result = {
            ...result,
            // in_amps: garder la valeur AI - NE PAS utiliser le cache
            // poles: garder la valeur AI - NE PAS utiliser le cache
            icu_ka: result.icu_ka || validatedMatch.icu_ka,
            ics_ka: result.ics_ka || validatedMatch.ics_ka,
            voltage_v: result.voltage_v || validatedMatch.voltage_v,
            trip_unit: result.trip_unit || validatedMatch.trip_unit,
            from_validated_cache: true
          };
          console.log(`[PHOTO ANALYSIS v2.0] Cache used for Icu=${result.icu_ka}kA, AI values preserved: in_amps=${result.in_amps}, poles=${result.poles}`);
        }
      } catch (e) { /* ignore cache errors */ }
    }

    console.log('[PHOTO ANALYSIS v2.0] Final result:', JSON.stringify(result, null, 2));

    res.json({
      ...result,
      cache_suggestions: cacheResults,
      from_cache: false,
      analysis_version: '2.0'
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS v2.0]', e.message);
    res.status(500).json({ error: 'Photo analysis failed: ' + e.message });
  }
});

// ============================================================
// PANEL SCAN - Analyse d'un tableau complet (multi-photos)
// ============================================================

// In-memory cache for panel scan jobs (backed by database for persistence)
const panelScanJobs = new Map();

// Cleanup old jobs from memory after 1 hour (database retains them)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of panelScanJobs) {
    if (job.created_at < oneHourAgo) panelScanJobs.delete(id);
  }
}, 300000);

// Helper: Save job to database for persistence
// images parameter is optional - only saved on initial creation for resume capability
async function savePanelScanJob(job, images = null) {
  try {
    // Only save images on initial creation (status = pending) to save bandwidth
    // Clear images once job is completed/failed to free up space
    const shouldSaveImages = images && job.status === 'pending';
    const shouldClearImages = job.status === 'completed' || job.status === 'failed';

    await pool.query(`
      INSERT INTO panel_scan_jobs (id, site, switchboard_id, user_email, status, progress, message, photos_count, result, error, created_at, completed_at, notified, images_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11::double precision / 1000), $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        status = $5,
        progress = $6,
        message = $7,
        result = $9,
        error = $10,
        completed_at = $12,
        notified = $13,
        images_data = CASE
          WHEN $15 THEN NULL
          WHEN $14 IS NOT NULL THEN $14
          ELSE panel_scan_jobs.images_data
        END
    `, [
      job.id,
      job.site || 'default',
      job.switchboard_id || null,
      job.user_email || null,
      job.status,
      job.progress,
      job.message || null,
      job.photos_count || 0,
      job.result ? JSON.stringify(job.result) : null,
      job.error || null,
      job.created_at,
      job.completed_at ? new Date(job.completed_at) : null,
      job.notified || false,
      shouldSaveImages ? JSON.stringify(images) : null,
      shouldClearImages
    ]);
    console.log(`[PANEL SCAN] Job ${job.id} saved to database (status: ${job.status}${shouldSaveImages ? ', with images' : ''}${shouldClearImages ? ', images cleared' : ''})`);
  } catch (e) {
    console.error(`[PANEL SCAN] Failed to save job ${job.id} to DB:`, e.message);
  }
}

// Helper: Load job from database
async function loadPanelScanJob(jobId) {
  try {
    const result = await pool.query(`
      SELECT id, site, switchboard_id, user_email, status, progress, message,
             photos_count, result, error,
             EXTRACT(EPOCH FROM created_at) * 1000 as created_at,
             EXTRACT(EPOCH FROM completed_at) * 1000 as completed_at,
             notified, images_data
      FROM panel_scan_jobs WHERE id = $1
    `, [jobId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      site: row.site,
      switchboard_id: row.switchboard_id,
      user_email: row.user_email,
      status: row.status,
      progress: row.progress,
      message: row.message,
      photos_count: row.photos_count,
      result: row.result,
      error: row.error,
      created_at: parseInt(row.created_at),
      completed_at: row.completed_at ? parseInt(row.completed_at) : null,
      notified: row.notified,
      images_data: row.images_data ? JSON.parse(row.images_data) : null
    };
  } catch (e) {
    console.error(`[PANEL SCAN] Failed to load job ${jobId} from DB:`, e.message);
    return null;
  }
}

// ============================================================
// RESUME PENDING JOBS - Called at server startup
// ============================================================
async function resumePendingJobs() {
  try {
    console.log('[PANEL SCAN] Checking for interrupted jobs to resume...');

    // Find jobs that were in progress (pending or analyzing) with images saved
    const result = await pool.query(`
      SELECT id, site, switchboard_id, user_email, status, progress, message,
             photos_count, images_data,
             EXTRACT(EPOCH FROM created_at) * 1000 as created_at
      FROM panel_scan_jobs
      WHERE status IN ('pending', 'analyzing')
        AND images_data IS NOT NULL
        AND created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
    `);

    if (result.rows.length === 0) {
      console.log('[PANEL SCAN] No interrupted jobs to resume');
      return;
    }

    console.log(`[PANEL SCAN] Found ${result.rows.length} interrupted job(s) to resume`);

    for (const row of result.rows) {
      try {
        const images = JSON.parse(row.images_data);
        if (!images || images.length === 0) {
          console.log(`[PANEL SCAN] Job ${row.id}: No images found, marking as failed`);
          await pool.query(`UPDATE panel_scan_jobs SET status = 'failed', error = 'No images after restart', images_data = NULL WHERE id = $1`, [row.id]);
          continue;
        }

        console.log(`[PANEL SCAN] Resuming job ${row.id} (was at ${row.progress}% - ${row.status})`);

        // Recreate job in memory
        const job = {
          id: row.id,
          site: row.site,
          status: 'pending', // Reset to pending for re-processing
          progress: 0,
          message: 'Reprise après redémarrage serveur...',
          switchboard_id: row.switchboard_id,
          photos_count: row.photos_count,
          created_at: parseInt(row.created_at),
          user_email: row.user_email,
          resumed: true
        };
        panelScanJobs.set(row.id, job);

        // Start processing in background
        setImmediate(async () => {
          try {
            console.log(`[PANEL SCAN] Background resume started for job ${row.id}`);
            await processPanelScan(row.id, images, row.site, row.switchboard_id, row.user_email);
            console.log(`[PANEL SCAN] Background resume finished for job ${row.id}`);
          } catch (resumeError) {
            console.error(`[PANEL SCAN] Resume error for job ${row.id}:`, resumeError.message);
            const failedJob = panelScanJobs.get(row.id);
            if (failedJob) {
              failedJob.status = 'failed';
              failedJob.error = 'Resume failed: ' + resumeError.message;
              failedJob.completed_at = Date.now();
              await savePanelScanJob(failedJob);
            }
          }
        });

        // Small delay between job resumes to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (jobError) {
        console.error(`[PANEL SCAN] Error resuming job ${row.id}:`, jobError.message);
        await pool.query(`UPDATE panel_scan_jobs SET status = 'failed', error = $2, images_data = NULL WHERE id = $1`, [row.id, 'Resume error: ' + jobError.message]);
      }
    }
  } catch (e) {
    console.error('[PANEL SCAN] Error checking for interrupted jobs:', e.message);
  }
}

// Background worker function
async function processPanelScan(jobId, images, site, switchboardId, userEmail) {
  const job = panelScanJobs.get(jobId);
  if (!job) return;

  // Prevent re-processing if job already completed or failed
  if (job.status === 'completed' || job.status === 'failed') {
    console.log(`[PANEL SCAN] Job ${jobId}: Already ${job.status}, skipping re-process`);
    return;
  }

  // Mark job as processing to prevent duplicate runs
  if (job.processing) {
    console.log(`[PANEL SCAN] Job ${jobId}: Already processing, skipping duplicate`);
    return;
  }
  job.processing = true;

  // Helper to save job progress to DB (ensures persistence even if user leaves)
  const saveProgress = async () => {
    try {
      await savePanelScanJob(job);
    } catch (e) {
      console.warn(`[PANEL SCAN] Failed to save progress: ${e.message}`);
    }
  };

  try {
    const startTime = Date.now();
    job.status = 'analyzing';
    job.progress = 5;
    job.message = 'Analyse IA GPT-4o en cours...';
    await saveProgress(); // Save initial state

    console.log(`\n${'='.repeat(70)}`);
    console.log(`[PANEL SCAN] Job ${jobId}: STARTING DUAL AI ANALYSIS`);
    console.log(`${'='.repeat(70)}`);
    console.log(`[PANEL SCAN] Images: ${images.length} photos`);
    console.log(`[PANEL SCAN] Site: ${site}, Switchboard: ${switchboardId}`);
    console.log(`[PANEL SCAN] User: ${userEmail}`);
    console.log(`[PANEL SCAN] OpenAI available: ${!!openai}, Gemini available: ${!!gemini}`);

    // Construire le message avec toutes les images
    const imageContents = images.map(img => ({
      type: 'image_url',
      image_url: img
    }));

    // Log image sizes
    for (let i = 0; i < images.length; i++) {
      const imgSize = images[i]?.url?.length || 0;
      console.log(`[PANEL SCAN] Image ${i + 1}: ${Math.round(imgSize / 1024)}KB base64`);
    }

    // ============================================================
    // PHASE 0: Detect and process listing photos separately
    // ============================================================
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 0: Detecting Listing Photos`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

    let listingData = [];
    let existingListingData = [];

    // First, load existing listing data from switchboard settings
    try {
      const boardResult = await quickQuery(
        `SELECT settings FROM switchboards WHERE id = $1 AND site = $2`,
        [switchboardId, site]
      );
      if (boardResult?.rows?.[0]?.settings?.listing_data?.entries) {
        existingListingData = boardResult.rows[0].settings.listing_data.entries;
        console.log(`[PANEL SCAN] Found existing listing data: ${existingListingData.length} entries (scanned at: ${boardResult.rows[0].settings.listing_data.scanned_at || 'unknown'})`);
      }
    } catch (loadErr) {
      console.warn(`[PANEL SCAN] Could not load existing listing: ${loadErr.message}`);
    }

    try {
      // Quick detection prompt
      const listingDetectPrompt = `Analyse ces images et identifie si certaines sont des DOCUMENTS PAPIER (listing/nomenclature de tableau électrique) vs des PHOTOS DU TABLEAU lui-même.

Un LISTING/NOMENCLATURE est un document papier/tableau imprimé qui liste les circuits avec:
- Numéro de position/repère (11F1, Q1, 1, 2...)
- Désignation du circuit (Éclairage, Prises, Chauffage...)
- Caractéristiques (calibre, pôles)

🚨 RÈGLE CRITIQUE - FORMAT DES PÔLES DANS LA COLONNE PROTECTION:
Le nombre de pôles est SOUVENT encodé dans le calibre avec le format "NxAA" où N = nombre de pôles:
- "16A" ou "C16" = 1 pôle (monophasé)
- "2x16A" = 2 pôles
- "3x16A" ou "3x32A" = 3 pôles (triphasé)
- "4x25A" ou "4x63A" = 4 pôles (tétrapolaire)

Exemples de lecture:
| Protection | → poles | → in_amps |
|------------|---------|-----------|
| 16A        | 1       | 16        |
| C16        | 1       | 16        |
| 3x16A      | 3       | 16        |
| 4x32A      | 4       | 32        |
| 3x63A      | 3       | 63        |
| 2x20A      | 2       | 20        |

IMPORTANT: Si tu détectes un listing, EXTRAIT les données de CHAQUE ligne:
- position: le repère/numéro (ex: "11F1", "Q1", "1")
- designation: le nom du circuit
- poles: le nombre de pôles (1, 2, 3 ou 4) - DÉDUIT du format NxAA !
- in_amps: le calibre en ampères (le nombre après le x)

Réponds en JSON:
{
  "has_listing_photos": true/false,
  "listing_indices": [0, 2],
  "listing_data": [
    {"position": "11F1", "designation": "Éclairage bureau", "poles": 1, "in_amps": 16},
    {"position": "11F2", "designation": "Four", "poles": 3, "in_amps": 32}
  ],
  "panel_photo_indices": [1, 3]
}`;

      const listingResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: listingDetectPrompt },
          { role: 'user', content: imageContents }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        temperature: 0.1
      });

      const listingResult = JSON.parse(listingResponse.choices[0].message.content);
      console.log(`[PANEL SCAN] Listing detection: has_listing=${listingResult.has_listing_photos}, entries=${listingResult.listing_data?.length || 0}`);

      if (listingResult.has_listing_photos && listingResult.listing_data?.length > 0) {
        // New listing detected in photos - use it and save
        listingData = listingResult.listing_data.filter(e => e.position);
        console.log(`[PANEL SCAN] ✅ NEW LISTING: Extracted ${listingData.length} entries from listing photos:`);
        listingData.forEach(e => console.log(`[PANEL SCAN]   - ${e.position}: ${e.designation || '?'} (${e.poles || '?'}P, ${e.in_amps || '?'}A)`));

        // Save listing data to switchboard settings for future use
        try {
          await quickQuery(`
            UPDATE switchboards
            SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{listing_data}',
              $2::jsonb
            )
            WHERE id = $1 AND site = $3
          `, [
            switchboardId,
            JSON.stringify({
              entries: listingData,
              scanned_at: new Date().toISOString(),
              from_panel_scan: true
            }),
            site
          ]);
          console.log(`[PANEL SCAN] Saved NEW listing data to switchboard settings`);
        } catch (dbErr) {
          console.warn(`[PANEL SCAN] Failed to save listing data: ${dbErr.message}`);
        }
      } else if (existingListingData.length > 0) {
        // No new listing in photos but we have existing data - REUSE IT!
        listingData = existingListingData;
        console.log(`[PANEL SCAN] ♻️ REUSING existing listing data: ${listingData.length} entries`);
        console.log(`[PANEL SCAN] (No listing photo detected in current scan, using previously saved data)`);
      } else {
        console.log(`[PANEL SCAN] ⚠️ No listing data available (none in photos, none saved)`);
      }
    } catch (listingErr) {
      console.warn(`[PANEL SCAN] Listing detection failed (non-blocking): ${listingErr.message}`);
      // If detection fails but we have existing data, use it as fallback
      if (existingListingData.length > 0) {
        listingData = existingListingData;
        console.log(`[PANEL SCAN] ♻️ Using existing listing as fallback after detection error: ${listingData.length} entries`);
      }
    }

    job.progress = 10;
    job.message = 'Analyse IA GPT-4o en cours...';
    await saveProgress();

    const systemPrompt = `Tu es un expert électricien spécialisé en identification d'appareillage électrique dans les tableaux.

MISSION CRITIQUE: Analyser la/les photo(s) d'un tableau électrique et identifier ABSOLUMENT TOUS les appareils modulaires visibles.
⚠️ NE MANQUER AUCUN APPAREIL - Compte chaque module visible sur chaque rangée. Si tu vois 35 appareils, tu dois en lister 35.

🚨🚨🚨 RÈGLE CRITIQUE - ANALYSE INDIVIDUELLE OBLIGATOIRE 🚨🚨🚨

⛔ CE QUE TU DOIS FAIRE:
Lis le CALIBRE IMPRIMÉ sur la face avant de CHAQUE disjoncteur séparément.
Rapporte EXACTEMENT ce que tu vois, même si ça donne des répétitions !

✅ EXEMPLES VALIDES (répétitions légitimes OK):
- C16, C16, C13, C16, C20 → OK (plusieurs C16 c'est normal)
- C13, C13, C13, C10, C16 → OK (3x C13 consécutifs = possible pour éclairage)
- C20, C20, C20, C20, C32 → OK (4x C20 pour circuits prises)
- C10, C10, C10, C10, C10, C16 → OK (5x C10 pour éclairage = COURANT !)

❌ CE QUI EST SUSPECT (probable erreur):
- 15+ disjoncteurs TOUS avec le MÊME calibre sans variation → Improbable, vérifie bien !
- TOUS les visual_evidence textuellement identiques → Tu n'as pas regardé chaque appareil

OBLIGATION pour CHAQUE disjoncteur:
1. Regarde SA face avant spécifiquement dans l'image
2. Lis SON calibre imprimé (C6, C10, C13, C16, C20, C25, C32, C40, C50, C63...)
3. Si ILLISIBLE sur la photo, mets confidence="low" et visual_evidence="ILLISIBLE - [raison]"
4. Décris dans visual_evidence ce que tu as VU sur CET appareil précis

RÉALITÉ TERRAIN:
- 2, 3, 4 ou même 5 disjoncteurs consécutifs avec le même calibre = TRÈS NORMAL
- Circuits éclairage: souvent C10 ou C13 en série
- Circuits prises: souvent C16 ou C20 en série
- Gros consommateurs: C32, C40 pour plaques, fours, etc.
- Ce qui est SUSPECT: 10+ sur 10 identiques ET visual_evidence copiés

ÉTIQUETTES DE POSITION - PRIORITÉ ABSOLUE:
- Lis les ÉTIQUETTES au-dessus ou en-dessous de chaque disjoncteur (ex: "1", "Q1", "11F1", "FI 11F1.A")
- Transcrire EXACTEMENT dans "position_label"
- ATTENTION: Les interrupteurs différentiels EN AMONT ont aussi une position (ex: "FI 11F1.A") - NE PAS LES OUBLIER !
- Si pas d'étiquette visible, mettre null (ne pas inventer)

LECTURE DU CALIBRE - ANALYSE VISUELLE INDIVIDUELLE:
Pour CHAQUE disjoncteur, regarde le TEXTE IMPRIMÉ sur sa face avant:
- "C16" = Courbe C, 16A | "C13" = Courbe C, 13A | "C10" = Courbe C, 10A
- "C20" = Courbe C, 20A | "C32" = Courbe C, 32A | "C40" = Courbe C, 40A
- "B16" = Courbe B, 16A | "D10" = Courbe D, 10A
⚠️ Le CALIBRE (C16, C13...) est DIFFÉRENT de la RÉFÉRENCE (C60N, iC60N...)
⚠️ CHAQUE disjoncteur a SON PROPRE calibre - LIS-LE sur l'appareil !

DISTINCTION MONOPHASÉ / TRIPHASÉ - POUR CHAQUE APPAREIL:
Regarde CHAQUE disjoncteur individuellement - ils peuvent être différents sur la même rangée !
1. COMPTE LA LARGEUR EN MODULES de CET appareil:
   - 1 module de large = 1P (1 pôle) = MONOPHASÉ → voltage=230V
   - 2 modules de large = 1P+N ou 2P = MONOPHASÉ → voltage=230V
   - 3 modules de large = 3P = TRIPHASÉ → voltage=400V
   - 4 modules de large = 3P+N ou 4P = TRIPHASÉ → voltage=400V

2. COMPTE LES MANETTES/LEVIERS de CET appareil:
   - 1 manette = 1P | 2 manettes liées = 2P | 3 manettes liées = 3P | 4 manettes liées = 4P

3. IMPORTANT: Sur une même rangée, tu peux avoir des disjoncteurs 2P ET des disjoncteurs 4P !

TOUS LES TYPES À IDENTIFIER (sans exception):

DISJONCTEURS MODULAIRES (résidentiel/tertiaire):
- Disjoncteurs magnéto-thermiques (calibres: C6, C10, C13, C16, C20, C25, C32, C40, C50, C63...)
- Disjoncteurs différentiels (2 ou 4 modules, bouton test visible)
- Interrupteurs différentiels (ID, iID) - EN AMONT des groupes

DISJONCTEURS INDUSTRIELS (CRITIQUES - bien identifier):
- Compact NSX (Schneider): 100A à 630A, boîtier moulé noir/vert
  * NSX100/160/250/400/630 avec unités TM-D, TM-G, ou Micrologic
  * LIRE le calibre sur la face: "100A", "160A", "250A", "400A", "630A"
  * Unité de déclenchement visible: TM (thermique-magnétique) ou Micrologic (électronique avec écran)
- Masterpact (Schneider): disjoncteurs ouverts/débrochables 800A à 6300A
  * Micrologic obligatoire (écran digital visible)
  * Lire: Icu, Icw, catégorie (A ou B)
- Tmax/SACE (ABB): 16A à 1600A, références T1/T2/T3/T4/T5/T6/T7
- NZM (Eaton): boîtier noir, 20A à 1600A
- DPX³ (Legrand): 160A à 1600A, boîtier gris

AUTRES ÉQUIPEMENTS:
- Interrupteurs sectionneurs (Q1, Q2, INS, Interpact)
- Contacteurs jour/nuit, Télérupteurs (TL, TLi, CT, iCT)
- Relais, Minuteries, Parafoudres, Horloges, Délesteurs
- Borniers (MGTB), Transformateurs modulaires

🔴 PREUVE VISUELLE OBLIGATOIRE - Pour CHAQUE appareil, tu DOIS remplir "visual_evidence" avec:
- Le texte EXACT que tu as lu sur l'appareil (calibre, référence, kA...)
- La POSITION précise de ce texte (face avant, côté, étiquette...)
- Si tu ne peux pas lire clairement, écris "ILLISIBLE - [raison]"

📊 CARACTÉRISTIQUES TECHNIQUES À RENSEIGNER:

POUVOIR DE COUPURE (Icu/Ics):
- Icu = Pouvoir de coupure ultime (en kA) - marqué sur l'appareil (ex: "6000" = 6kA)
- Ics = Pouvoir de coupure de service - généralement égal à Icu pour les modulaires
- Pour les modulaires: Ics = Icu (100%)
- Pour les industriels: Ics peut être 25%, 50%, 75% ou 100% de Icu

TYPE DE DÉCLENCHEUR (trip_unit) - OBLIGATOIRE:
- Disjoncteurs modulaires (C60, iC60, DX³...): "thermique-magnétique"
- Disjoncteurs industriels avec TM-D ou TM-G: "thermique-magnétique réglable"
- Disjoncteurs avec Micrologic (écran digital): "électronique"
- Interrupteurs différentiels (ID, iID): null (pas de déclencheur, juste différentiel)
- Contacteurs, télérupteurs: null

POUR CHAQUE APPAREIL:
{
  "position_label": "11F3" ou null,
  "circuit_name": "Éclairage" ou null,
  "row": 1,
  "position_in_row": 3,
  "device_type": "Disjoncteur modulaire",
  "manufacturer": "Schneider",
  "reference": "iC60N",
  "in_amps": "LIRE sur l'appareil - ne pas deviner",
  "curve_type": "C",
  "icu_ka": 6,
  "ics_ka": 6,
  "voltage_v": 230,
  "poles": 2,
  "width_modules": 2,
  "is_differential": false,
  "differential_sensitivity_ma": null,
  "differential_type": null,
  "trip_unit": "thermique-magnétique",
  "confidence": "high/medium/low",
  "visual_evidence": {
    "caliber_text_seen": "C16 - lu sur face avant en gros caractères",
    "reference_text_seen": "iC60N - écrit sous le logo Schneider",
    "icu_text_seen": "6000 dans rectangle - bas de la face avant",
    "other_markings": ["230/400V~", "IEC 60898"]
  },
  "notes": ""
}

Réponds en JSON:
{
  "panel_description": "Description",
  "total_devices_detected": number,
  "rows_count": number,
  "devices": [...],
  "analysis_notes": ""
}`;

    const userPrompt = `Analyse ${images.length > 1 ? 'ces photos' : 'cette photo'} de tableau électrique.

🚨 RÈGLE #1 - ANALYSE INDIVIDUELLE:
Pour CHAQUE disjoncteur, tu DOIS lire son calibre PROPRE sur sa face avant.
NE COPIE PAS le même calibre pour tous ! Les calibres VARIENT sur un tableau réel.
Exemple typique: C16, C10, C13, C20, C13, C32... pas "C16" partout !

⚠️ INSTRUCTIONS CRITIQUES:
1. Compte TOUS les appareils modulaires visibles sur CHAQUE rangée - N'EN OUBLIE AUCUN
2. Pour CHAQUE appareil individuellement, lis le CALIBRE imprimé (C6, C10, C13, C16, C20, C25, C32, C40...)
3. Si tu ne peux pas lire le calibre clairement, note "ILLISIBLE" dans visual_evidence
4. Le visual_evidence DOIT être DIFFÉRENT pour chaque appareil
5. Compte la LARGEUR EN MODULES pour déterminer mono (1-2 modules) vs triphasé (3-4 modules)
6. N'oublie pas les interrupteurs différentiels EN AMONT des groupes

Identifie ABSOLUMENT TOUS les appareils avec leurs caractéristiques techniques PRÉCISES et INDIVIDUELLES.`;

    // ============================================================
    // PHASE 1: Analyse principale avec GPT-4o
    // ============================================================
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 1: GPT-4o Analysis`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);
    const gptStartTime = Date.now();

    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...imageContents
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 16000,
      temperature: 0.1
    });

    const gptDuration = Date.now() - gptStartTime;
    const gptTokens = visionResponse.usage || {};
    console.log(`[PANEL SCAN] GPT-4o completed in ${gptDuration}ms`);
    console.log(`[PANEL SCAN] GPT-4o tokens: prompt=${gptTokens.prompt_tokens || '?'}, completion=${gptTokens.completion_tokens || '?'}, total=${gptTokens.total_tokens || '?'}`);
    console.log(`[PANEL SCAN] GPT-4o response length: ${visionResponse.choices[0]?.message?.content?.length || 0} chars`);

    job.progress = 25;
    job.message = 'GPT-4o terminé, vérification avec Gemini...';
    await saveProgress(); // Save after GPT-4o

    // ============================================================
    // PHASE 2: Vérification/Complément avec Gemini
    // ============================================================
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 2: Gemini Verification`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

    let geminiResult = null;
    if (gemini) {
      const geminiStartTime = Date.now();
      try {
        // Utiliser Gemini 2.5 Pro pour la meilleure analyse visuelle
        const geminiModel = gemini.getGenerativeModel({
          model: 'gemini-2.5-pro',
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16000,
          },
        });

        // Préparer les images pour Gemini
        const geminiParts = [
          { text: `${systemPrompt}\n\n---\n\n${userPrompt}` }
        ];

        // Ajouter les images à Gemini
        let geminiImagesAdded = 0;
        for (const img of images) {
          const url = img.url || '';
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            geminiParts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
            geminiImagesAdded++;
          }
        }
        console.log(`[PANEL SCAN] Gemini: ${geminiImagesAdded}/${images.length} images prepared`);

        const geminiResponse = await geminiModel.generateContent({ contents: [{ role: 'user', parts: geminiParts }] });
        const geminiText = geminiResponse.response.text();
        const geminiDuration = Date.now() - geminiStartTime;

        console.log(`[PANEL SCAN] Gemini completed in ${geminiDuration}ms`);
        console.log(`[PANEL SCAN] Gemini response length: ${geminiText.length} chars`);

        // Parse Gemini JSON with repair for truncated responses
        let cleanedGemini = geminiText.trim();
        if (cleanedGemini.startsWith('```json')) cleanedGemini = cleanedGemini.slice(7);
        if (cleanedGemini.startsWith('```')) cleanedGemini = cleanedGemini.slice(3);
        if (cleanedGemini.endsWith('```')) cleanedGemini = cleanedGemini.slice(0, -3);

        try {
          geminiResult = JSON.parse(cleanedGemini.trim());
        } catch (jsonError) {
          console.log(`[PANEL SCAN] Gemini JSON truncated, attempting repair...`);
          // Try to repair truncated JSON by finding last complete device
          let repairedGemini = cleanedGemini.trim();

          // Find the last complete "}" that could close a device object
          const lastDeviceEnd = repairedGemini.lastIndexOf('}');
          if (lastDeviceEnd > 0) {
            // Try to find the devices array and close it properly
            const devicesStart = repairedGemini.indexOf('"devices"');
            if (devicesStart > 0) {
              // Find where devices array starts
              const arrayStart = repairedGemini.indexOf('[', devicesStart);
              if (arrayStart > 0) {
                // Count brackets to find last complete device
                let bracketCount = 0;
                let lastCompleteDevice = -1;
                for (let i = arrayStart; i < repairedGemini.length; i++) {
                  if (repairedGemini[i] === '{') bracketCount++;
                  if (repairedGemini[i] === '}') {
                    bracketCount--;
                    if (bracketCount === 0) lastCompleteDevice = i;
                  }
                }

                if (lastCompleteDevice > 0) {
                  // Truncate at last complete device and close JSON
                  repairedGemini = repairedGemini.substring(0, lastCompleteDevice + 1) + ']}';
                  try {
                    geminiResult = JSON.parse(repairedGemini);
                    console.log(`[PANEL SCAN] ✓ Gemini JSON repaired successfully, found ${geminiResult.devices?.length || 0} devices`);
                  } catch (repairError) {
                    console.error(`[PANEL SCAN] Gemini JSON repair failed:`, repairError.message);
                  }
                }
              }
            }
          }
        }

        if (geminiResult) {
          console.log(`[PANEL SCAN] Gemini detected: ${geminiResult.devices?.length || 0} devices`);

          // Log device types detected by Gemini
          if (geminiResult.devices?.length) {
            const geminiTypes = {};
            geminiResult.devices.forEach(d => {
              const type = d.device_type || 'Unknown';
              geminiTypes[type] = (geminiTypes[type] || 0) + 1;
            });
            console.log(`[PANEL SCAN] Gemini device types:`, JSON.stringify(geminiTypes));
          }
        }
      } catch (geminiError) {
        const geminiDuration = Date.now() - geminiStartTime;
        console.error(`[PANEL SCAN] ❌ Gemini FAILED after ${geminiDuration}ms:`, geminiError.message);
        console.error(`[PANEL SCAN] Gemini error stack:`, geminiError.stack?.split('\n').slice(0, 3).join('\n'));
      }
    } else {
      console.log(`[PANEL SCAN] ⚠️ Gemini not available - skipping verification`);
    }

    job.progress = 40;
    job.message = 'Fusion des résultats IA...';
    await saveProgress(); // Save after Gemini

    // Parse JSON with error recovery
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 3: Parse GPT-4o Response`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

    let result;
    const rawContent = visionResponse.choices[0].message.content;
    try {
      result = JSON.parse(rawContent);
      console.log(`[PANEL SCAN] GPT-4o JSON parsed successfully`);
    } catch (parseError) {
      console.error(`[PANEL SCAN] ❌ GPT-4o JSON parse error: ${parseError.message}`);
      console.error(`[PANEL SCAN] Raw content length: ${rawContent?.length}`);
      console.error(`[PANEL SCAN] Raw content start: ${rawContent?.substring(0, 200)}...`);
      console.error(`[PANEL SCAN] Raw content end: ...${rawContent?.substring(rawContent.length - 200)}`);

      // Try to repair truncated JSON
      let repairedContent = rawContent;

      // If it ends with an incomplete string, try to close it
      if (repairedContent && !repairedContent.trim().endsWith('}')) {
        // Find the last complete device entry
        const lastDeviceEnd = repairedContent.lastIndexOf('},');
        if (lastDeviceEnd > 0) {
          repairedContent = repairedContent.substring(0, lastDeviceEnd + 1);
          // Close the devices array and main object
          repairedContent += '], "analysis_notes": "Réponse tronquée - certains appareils peuvent manquer" }';
        }
      }

      try {
        result = JSON.parse(repairedContent);
        console.log(`[PANEL SCAN] Job ${jobId}: JSON repair successful`);
      } catch (repairError) {
        // Last resort: return minimal result
        console.error(`[PANEL SCAN] Job ${jobId}: JSON repair failed, using fallback`);
        result = {
          panel_description: "Erreur d'analyse - veuillez réessayer avec moins de photos",
          total_devices_detected: 0,
          devices: [],
          analysis_notes: `Erreur de parsing: ${parseError.message}`
        };
      }
    }

    // Ensure devices array exists
    if (!result.devices || !Array.isArray(result.devices)) {
      result.devices = [];
    }

    // Log GPT-4o device types
    const gptTypes = {};
    result.devices.forEach(d => {
      const type = d.device_type || 'Unknown';
      gptTypes[type] = (gptTypes[type] || 0) + 1;
    });
    console.log(`[PANEL SCAN] GPT-4o detected: ${result.devices.length} devices`);
    console.log(`[PANEL SCAN] GPT-4o device types:`, JSON.stringify(gptTypes));

    // Log a sample of devices
    console.log(`[PANEL SCAN] GPT-4o sample devices:`);
    result.devices.slice(0, 5).forEach((d, i) => {
      console.log(`[PANEL SCAN]   ${i + 1}. ${d.position_label || 'R' + d.row + '-P' + d.position_in_row}: ${d.device_type} ${d.reference || ''} ${d.in_amps || '?'}A ${d.poles || '?'}P`);
    });
    if (result.devices.length > 5) {
      console.log(`[PANEL SCAN]   ... and ${result.devices.length - 5} more`);
    }

    // ============================================================
    // PHASE 4: Fusion intelligente des résultats GPT-4o + Gemini
    // ============================================================
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 4: Smart Merge GPT-4o + Gemini`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);
    if (geminiResult?.devices?.length) {
      const gptDeviceCount = result.devices.length;
      const geminiDeviceCount = geminiResult.devices.length;

      console.log(`[PANEL SCAN] Job ${jobId}: Smart merge GPT-4o (${gptDeviceCount}) + Gemini (${geminiDeviceCount})`);

      // Créer une map des devices Gemini par position pour lookup rapide
      const geminiByPosition = new Map();
      for (const gd of geminiResult.devices) {
        const key = gd.position_label || `R${gd.row}-P${gd.position_in_row}`;
        geminiByPosition.set(key, gd);
      }

      // Fonction pour fusionner intelligemment deux devices
      const mergeDevices = (gptDevice, geminiDevice) => {
        if (!geminiDevice) return gptDevice;

        const merged = { ...gptDevice };

        // Prendre le type d'appareil le plus spécifique (celui avec le plus de mots)
        if (geminiDevice.device_type && (!gptDevice.device_type ||
            geminiDevice.device_type.length > gptDevice.device_type.length)) {
          merged.device_type = geminiDevice.device_type;
          merged.notes = (merged.notes || '') + ' [type Gemini]';
        }

        // Si les calibres diffèrent, préférer Gemini (étape de vérification)
        // IMPORTANT: Ne pas supposer que GPT ou Gemini a raison par défaut
        if (geminiDevice.in_amps && gptDevice.in_amps &&
            geminiDevice.in_amps !== gptDevice.in_amps) {
          // Logique améliorée: préférer Gemini sauf si c'est 16A (valeur par défaut courante)
          // ET que GPT a une valeur plus spécifique
          const commonDefaults = [16, 20, 10]; // Valeurs souvent devinées par défaut
          const gptIsCommon = commonDefaults.includes(gptDevice.in_amps);
          const geminiIsCommon = commonDefaults.includes(geminiDevice.in_amps);

          // Si Gemini a une valeur spécifique (13, 6, 25, 32, 40...) et GPT a une valeur commune, préférer Gemini
          if (gptIsCommon && !geminiIsCommon) {
            merged.in_amps = geminiDevice.in_amps;
            merged.notes = (merged.notes || '') + ` [calibre Gemini: ${geminiDevice.in_amps}A, GPT avait: ${gptDevice.in_amps}A]`;
          } else if (!gptIsCommon && geminiIsCommon) {
            // GPT a une valeur spécifique, garder GPT
            merged.notes = (merged.notes || '') + ` [calibre GPT conservé: ${gptDevice.in_amps}A, Gemini avait: ${geminiDevice.in_amps}A]`;
          } else {
            // Les deux ont des valeurs spécifiques ou communes - marquer comme incertain
            merged.caliber_uncertain = true;
            merged.caliber_conflict = { gpt: gptDevice.in_amps, gemini: geminiDevice.in_amps };
            merged.notes = (merged.notes || '') + ` [⚠️ CALIBRE INCERTAIN: GPT=${gptDevice.in_amps}A vs Gemini=${geminiDevice.in_amps}A - VÉRIFIER]`;
          }
          console.log(`[PANEL SCAN] Caliber conflict at ${gptDevice.position_label}: GPT=${gptDevice.in_amps}A vs Gemini=${geminiDevice.in_amps}A`);
        } else if (!gptDevice.in_amps && geminiDevice.in_amps) {
          merged.in_amps = geminiDevice.in_amps;
        }

        // Courbe: prendre si manquante
        if (!gptDevice.curve_type && geminiDevice.curve_type) {
          merged.curve_type = geminiDevice.curve_type;
        }

        // Référence: prendre la plus longue/détaillée
        if (geminiDevice.reference && (!gptDevice.reference ||
            geminiDevice.reference.length > gptDevice.reference.length)) {
          merged.reference = geminiDevice.reference;
        }

        // Fabricant: prendre si manquant ou si Gemini est plus précis
        if (!gptDevice.manufacturer && geminiDevice.manufacturer) {
          merged.manufacturer = geminiDevice.manufacturer;
        }

        // Pôles: utiliser width_modules comme vérification croisée
        if (geminiDevice.poles && gptDevice.poles && geminiDevice.poles !== gptDevice.poles) {
          // Utiliser width_modules comme arbitre si disponible
          const widthModules = gptDevice.width_modules || geminiDevice.width_modules;
          if (widthModules) {
            // 1-2 modules = 1-2P (monophasé), 3-4 modules = 3-4P (triphasé)
            const expectedPoles = widthModules >= 3 ? (widthModules === 3 ? 3 : 4) : widthModules;
            // Préférer celui qui correspond à la largeur
            if (gptDevice.poles === expectedPoles) {
              merged.poles = gptDevice.poles;
              merged.notes = (merged.notes || '') + ` [pôles GPT confirmé par largeur ${widthModules}M]`;
            } else if (geminiDevice.poles === expectedPoles) {
              merged.poles = geminiDevice.poles;
              merged.notes = (merged.notes || '') + ` [pôles Gemini confirmé par largeur ${widthModules}M]`;
            } else {
              // Aucun ne correspond, marquer comme incertain
              merged.poles_uncertain = true;
              merged.poles_conflict = { gpt: gptDevice.poles, gemini: geminiDevice.poles, width: widthModules };
              merged.notes = (merged.notes || '') + ` [⚠️ PÔLES INCERTAINS: GPT=${gptDevice.poles}P vs Gemini=${geminiDevice.poles}P, largeur=${widthModules}M]`;
              merged.poles = widthModules; // Utiliser la largeur comme estimation
            }
          } else {
            // Pas de width_modules, marquer comme incertain
            merged.poles_uncertain = true;
            merged.poles_conflict = { gpt: gptDevice.poles, gemini: geminiDevice.poles };
            merged.notes = (merged.notes || '') + ` [⚠️ PÔLES INCERTAINS: GPT=${gptDevice.poles}P vs Gemini=${geminiDevice.poles}P - VÉRIFIER]`;
          }
          console.log(`[PANEL SCAN] Poles conflict at ${gptDevice.position_label}: GPT=${gptDevice.poles}P vs Gemini=${geminiDevice.poles}P (width=${widthModules || '?'}M)`);
        } else if (!gptDevice.poles && geminiDevice.poles) {
          merged.poles = geminiDevice.poles;
        }

        // Différentiel: si Gemini dit que c'est différentiel et pas GPT, faire confiance à Gemini
        if (geminiDevice.is_differential && !gptDevice.is_differential) {
          merged.is_differential = true;
          merged.differential_sensitivity_ma = geminiDevice.differential_sensitivity_ma;
          merged.differential_type = geminiDevice.differential_type;
          merged.notes = (merged.notes || '') + ' [diff Gemini]';
        }

        return merged;
      };

      // Fusionner les devices existants avec les infos Gemini
      result.devices = result.devices.map(gptDevice => {
        const key = gptDevice.position_label || `R${gptDevice.row}-P${gptDevice.position_in_row}`;
        const geminiDevice = geminiByPosition.get(key);
        geminiByPosition.delete(key); // Marquer comme traité
        return mergeDevices(gptDevice, geminiDevice);
      });

      // Ajouter les devices que Gemini a trouvé mais pas GPT
      let addedCount = 0;
      for (const [key, geminiDevice] of geminiByPosition) {
        result.devices.push({
          ...geminiDevice,
          notes: (geminiDevice.notes || '') + ' [ajouté par Gemini]'
        });
        addedCount++;
        console.log(`[PANEL SCAN] Job ${jobId}: Added device ${key} from Gemini (${geminiDevice.device_type})`);
      }

      if (addedCount > 0 || geminiDeviceCount > 0) {
        result.analysis_notes = `Analyse combinée GPT-4o + Gemini (${addedCount} ajoutés, infos croisées). ${result.analysis_notes || ''}`;
      }

      // Corriger voltage basé sur poles/width_modules
      result.devices = result.devices.map(d => {
        const poles = d.poles || d.width_modules || 2;
        let voltage = d.voltage_v;

        // Règle: 3+ pôles = triphasé = 400V
        if (poles >= 3 && (!voltage || voltage === 230)) {
          voltage = 400;
        } else if (poles <= 2 && (!voltage || voltage === 400)) {
          voltage = 230;
        }

        return {
          ...d,
          poles: poles,
          voltage_v: voltage || (poles >= 3 ? 400 : 230)
        };
      });
    }

    // Tri par rangée et position
    result.devices.sort((a, b) => {
      if (a.row !== b.row) return (a.row || 1) - (b.row || 1);
      return (a.position_in_row || 1) - (b.position_in_row || 1);
    });

    const deviceCount = result.devices.length;
    result.total_devices_detected = deviceCount;

    // Final merge summary
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] MERGE SUMMARY`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] ✓ Final device count: ${deviceCount}`);

    // Count by type after merge
    const finalTypes = {};
    const triphaseCounts = { mono: 0, tri: 0 };
    result.devices.forEach(d => {
      const type = d.device_type || 'Unknown';
      finalTypes[type] = (finalTypes[type] || 0) + 1;
      if ((d.poles || 2) >= 3) triphaseCounts.tri++;
      else triphaseCounts.mono++;
    });
    console.log(`[PANEL SCAN] ✓ Device types:`, JSON.stringify(finalTypes));
    console.log(`[PANEL SCAN] ✓ Mono/Tri: ${triphaseCounts.mono} monophasé, ${triphaseCounts.tri} triphasé`);

    // Show devices with notes (from Gemini corrections)
    const correctedDevices = result.devices.filter(d => d.notes?.includes('Gemini'));
    if (correctedDevices.length > 0) {
      console.log(`[PANEL SCAN] ✓ Corrections from Gemini: ${correctedDevices.length} devices`);
      correctedDevices.forEach(d => {
        console.log(`[PANEL SCAN]   - ${d.position_label || 'R' + d.row}: ${d.notes}`);
      });
    }

    // ============================================================
    // POST-PROCESSING: Détection de calibres suspects
    // ============================================================
    // Si plusieurs disjoncteurs de même référence ont TOUS le même calibre, c'est suspect
    const breakers = result.devices.filter(d =>
      d.device_type?.toLowerCase().includes('disjoncteur') &&
      !d.device_type?.toLowerCase().includes('différentiel') &&
      d.reference && d.in_amps
    );

    // Grouper par référence
    const refGroups = {};
    for (const b of breakers) {
      const refNorm = (b.reference || '').toUpperCase().replace(/\s+/g, '');
      if (!refGroups[refNorm]) refGroups[refNorm] = [];
      refGroups[refNorm].push(b);
    }

    // Vérifier chaque groupe
    let suspiciousCount = 0;
    for (const [ref, devices] of Object.entries(refGroups)) {
      if (devices.length >= 3) { // Au moins 3 disjoncteurs de même référence
        const calibers = devices.map(d => d.in_amps);
        const uniqueCalib = [...new Set(calibers)];

        // Si TOUS ont exactement le même calibre, c'est suspect
        if (uniqueCalib.length === 1) {
          console.log(`[PANEL SCAN] ⚠️ SUSPECT: ${devices.length} disjoncteurs ${ref} ont TOUS le même calibre (${uniqueCalib[0]}A) - vérifier individuellement!`);

          // Marquer ces devices comme suspects
          for (const d of devices) {
            d.caliber_suspect = true;
            d.notes = (d.notes || '') + ` [⚠️ SUSPECT: tous les ${ref} ont ${uniqueCalib[0]}A - vérifier]`;
          }
          suspiciousCount += devices.length;
        } else {
          // Calibres variés = bon signe, l'AI a bien analysé individuellement
          console.log(`[PANEL SCAN] ✓ ${devices.length} disjoncteurs ${ref} avec calibres variés: ${uniqueCalib.join('A, ')}A`);
        }
      }
    }

    if (suspiciousCount > 0) {
      result.warnings = result.warnings || [];
      result.warnings.push({
        type: 'CALIBER_UNIFORMITY_SUSPECT',
        message: `${suspiciousCount} disjoncteurs avec calibres potentiellement incorrects (même référence, même calibre). Vérification manuelle recommandée.`,
        count: suspiciousCount
      });
      console.log(`[PANEL SCAN] ⚠️ WARNING: ${suspiciousCount} devices with suspicious uniform calibers`);

      // ============================================================
      // PHASE 4.5: RÉ-ANALYSE CIBLÉE des calibres suspects avec Gemini
      // ============================================================
      if (gemini && suspiciousCount > 0 && suspiciousCount <= 60) {
        console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
        console.log(`[PANEL SCAN] PHASE 4.5: Re-analysis of ${suspiciousCount} suspicious calibers`);
        console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

        try {
          // Collecter les positions suspectes
          const suspiciousPositions = result.devices
            .filter(d => d.caliber_suspect)
            .map(d => d.position_label || `R${d.row}-P${d.position_in_row}`)
            .slice(0, 30); // Limiter à 30 positions

          const reanalysisPrompt = `MISSION CRITIQUE: Ré-analyse des CALIBRES uniquement.

Je te donne la MÊME photo qu'avant. Tu as identifié ${suspiciousCount} disjoncteurs de même référence avec TOUS le même calibre.
C'est STATISTIQUEMENT IMPROBABLE sur un vrai tableau électrique !

POSITIONS À VÉRIFIER (regarde CHAQUE position individuellement):
${suspiciousPositions.join(', ')}

Pour CHAQUE position listée, regarde la FACE AVANT du disjoncteur et lis le CALIBRE imprimé:
- Format typique: "C16", "C13", "C10", "C20", "C32", "B10", etc.
- Le calibre est souvent en GROS caractères sur la face avant
- Regarde ATTENTIVEMENT chaque appareil, les calibres VARIENT !

Réponds UNIQUEMENT en JSON:
{
  "calibers": {
    "11F1": {"caliber": "C16", "confidence": "high/low", "readable": true},
    "11F2": {"caliber": "C13", "confidence": "high", "readable": true},
    "11F3": {"caliber": "ILLISIBLE", "confidence": "low", "readable": false}
  },
  "notes": "Observations sur la lisibilité"
}

IMPORTANT: Si tu vois le MÊME calibre partout, vérifie que tu n'as pas copié-collé !`;

          // Utiliser Gemini 2.5 Pro pour la ré-analyse précise des calibres
          const geminiReanalysisModel = gemini.getGenerativeModel({
            model: 'gemini-2.5-pro',
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000,
            },
          });

          // Préparer les images pour Gemini
          const reanalysisParts = [{ text: reanalysisPrompt }];
          for (const img of images) {
            const url = img.url || '';
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              reanalysisParts.push({
                inlineData: { mimeType: match[1], data: match[2] },
              });
            }
          }

          const reanalysisStart = Date.now();
          const reanalysisResponse = await geminiReanalysisModel.generateContent({
            contents: [{ role: 'user', parts: reanalysisParts }]
          });
          const reanalysisText = reanalysisResponse.response.text();
          const reanalysisDuration = Date.now() - reanalysisStart;

          console.log(`[PANEL SCAN] Gemini re-analysis completed in ${reanalysisDuration}ms`);

          // Parse le JSON de ré-analyse
          let cleanedReanalysis = reanalysisText.trim();
          if (cleanedReanalysis.startsWith('```json')) cleanedReanalysis = cleanedReanalysis.slice(7);
          if (cleanedReanalysis.startsWith('```')) cleanedReanalysis = cleanedReanalysis.slice(3);
          if (cleanedReanalysis.endsWith('```')) cleanedReanalysis = cleanedReanalysis.slice(0, -3);

          try {
            const reanalysisResult = JSON.parse(cleanedReanalysis.trim());

            if (reanalysisResult.calibers) {
              let updatedCount = 0;
              for (const device of result.devices) {
                if (!device.caliber_suspect) continue;

                const posKey = device.position_label || `R${device.row}-P${device.position_in_row}`;
                const newCaliberData = reanalysisResult.calibers[posKey];

                if (newCaliberData && newCaliberData.readable && newCaliberData.caliber !== 'ILLISIBLE') {
                  // Extraire le nombre du calibre (C16 -> 16)
                  const caliberMatch = newCaliberData.caliber.match(/[CBDKZ]?(\d+)/i);
                  if (caliberMatch) {
                    const newAmps = parseInt(caliberMatch[1]);
                    if (newAmps !== device.in_amps) {
                      console.log(`[PANEL SCAN] ✓ RE-ANALYSIS: ${posKey}: ${device.in_amps}A → ${newAmps}A`);
                      device.in_amps = newAmps;
                      device.notes = (device.notes || '').replace(/\[⚠️ SUSPECT.*?\]/, '') +
                        ` [✓ Calibre corrigé par ré-analyse: ${newAmps}A]`;
                      device.caliber_suspect = false;
                      updatedCount++;
                    }
                  }
                }
              }

              if (updatedCount > 0) {
                console.log(`[PANEL SCAN] ✓ RE-ANALYSIS: ${updatedCount} calibres corrigés`);
                suspiciousCount -= updatedCount;

                // Mettre à jour le warning
                const warningIndex = result.warnings.findIndex(w => w.type === 'CALIBER_UNIFORMITY_SUSPECT');
                if (warningIndex >= 0) {
                  if (suspiciousCount <= 0) {
                    result.warnings.splice(warningIndex, 1);
                  } else {
                    result.warnings[warningIndex].count = suspiciousCount;
                    result.warnings[warningIndex].message = `${suspiciousCount} disjoncteurs restants à vérifier après ré-analyse.`;
                  }
                }
              } else {
                console.log(`[PANEL SCAN] ⚠️ RE-ANALYSIS: Aucun calibre corrigé (peut-être illisibles sur les photos)`);
              }
            }
          } catch (parseErr) {
            console.error(`[PANEL SCAN] ❌ RE-ANALYSIS parse error:`, parseErr.message);
          }
        } catch (reanalysisError) {
          console.error(`[PANEL SCAN] ❌ RE-ANALYSIS error:`, reanalysisError.message);
        }
      }
    }

    // ============================================================
    // VALIDATION: Vérifier la qualité de l'analyse visuelle
    // ============================================================
    let missingEvidenceCount = 0;
    let duplicateEvidenceCount = 0;
    const evidenceTexts = new Map(); // Pour détecter les duplications

    for (const device of result.devices) {
      const ve = device.visual_evidence;

      // Vérifier si visual_evidence existe
      if (!ve || typeof ve !== 'object') {
        missingEvidenceCount++;
        device.analysis_quality = 'low';
        device.notes = (device.notes || '') + ' [⚠️ SANS PREUVE VISUELLE]';
        continue;
      }

      // Vérifier si le calibre a été lu
      const caliberEvidence = ve.caliber_text_seen || '';
      if (!caliberEvidence || caliberEvidence.includes('ILLISIBLE') || caliberEvidence.length < 2) {
        device.caliber_confidence = 'low';
        device.notes = (device.notes || '') + ' [calibre non confirmé visuellement]';
      }

      // Détecter les duplications suspectes (même visual_evidence = copier-coller)
      const evidenceKey = JSON.stringify(ve);
      if (evidenceTexts.has(evidenceKey)) {
        duplicateEvidenceCount++;
        device.duplicate_evidence = true;
        device.notes = (device.notes || '') + ' [⚠️ EVIDENCE DUPLIQUÉE - analyse individuelle douteuse]';
      } else {
        evidenceTexts.set(evidenceKey, device.position_label || `R${device.row}-P${device.position_in_row}`);
      }
    }

    // Log qualité d'analyse
    console.log(`[PANEL SCAN] ✓ Analyse visuelle: ${result.devices.length - missingEvidenceCount}/${result.devices.length} avec preuves`);
    if (missingEvidenceCount > 0) {
      console.log(`[PANEL SCAN] ⚠️ ${missingEvidenceCount} appareils SANS preuve visuelle`);
    }
    if (duplicateEvidenceCount > 0) {
      console.log(`[PANEL SCAN] ⚠️ ${duplicateEvidenceCount} appareils avec preuves DUPLIQUÉES (copier-coller suspect)`);
      result.warnings = result.warnings || [];
      result.warnings.push({
        type: 'DUPLICATE_VISUAL_EVIDENCE',
        message: `${duplicateEvidenceCount} appareils ont exactement la même preuve visuelle - l'IA n'a peut-être pas analysé chaque appareil individuellement.`,
        count: duplicateEvidenceCount
      });
    }

    // Score de qualité global (0-100, clamped)
    const problemCount = missingEvidenceCount + duplicateEvidenceCount + suspiciousCount;
    const rawScore = 100 * (1 - problemCount / Math.max(1, result.devices.length));
    const qualityScore = Math.max(0, Math.min(100, Math.round(rawScore)));
    result.analysis_quality_score = qualityScore;
    result.analysis_quality = qualityScore >= 80 ? 'high' : qualityScore >= 50 ? 'medium' : 'low';
    console.log(`[PANEL SCAN] ✓ Score qualité analyse: ${qualityScore}% (${result.analysis_quality}) - ${problemCount} problèmes sur ${result.devices.length} appareils`);

    const warningCount = (result.warnings || []).length;
    job.progress = 50;
    job.message = `${deviceCount} appareils détectés${warningCount > 0 ? ` (${warningCount} alertes)` : ''}, enrichissement via cache...`;
    await saveProgress(); // Save after merge

    // ============================================================
    // PHASE 5: Cache enrichment
    // ============================================================
    console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
    console.log(`[PANEL SCAN] PHASE 5: Cache Enrichment`);
    console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

    // Note: normalizeRef is defined globally for consistent reference matching

    // Chercher dans le cache des produits déjà scannés
    let cachedProducts = [];
    try {
      const { rows } = await quickQuery(`
        SELECT reference, manufacturer, in_amps, icu_ka, ics_ka, poles, voltage_v, curve_type, validated, scan_count
        FROM scanned_products WHERE site = $1
        ORDER BY validated DESC, scan_count DESC
      `, [site]);
      cachedProducts = rows;
      console.log(`[PANEL SCAN] Cache: ${cachedProducts.length} products found for site ${site}`);
    } catch (e) {
      console.error('[PANEL SCAN] ❌ Cache lookup failed:', e.message);
    }

    job.progress = 60;

    // Enrichir chaque appareil depuis le cache ou avec des valeurs par défaut
    const devicesToEnrich = [];
    result.devices = result.devices.map((device, idx) => {
      // Chercher dans le cache par référence normalisée
      const deviceRefNorm = normalizeRef(device.reference);
      const deviceMfgNorm = device.manufacturer?.toLowerCase() || '';

      const cached = cachedProducts.find(c => {
        const cachedRefNorm = normalizeRef(c.reference);
        const cachedMfgNorm = c.manufacturer?.toLowerCase() || '';

        // Match exact ou partiel sur référence
        if (cachedRefNorm && deviceRefNorm) {
          if (cachedRefNorm === deviceRefNorm) return true;
          if (cachedRefNorm.includes(deviceRefNorm) || deviceRefNorm.includes(cachedRefNorm)) return true;
        }
        // Match par fabricant + ampérage
        if (cachedMfgNorm === deviceMfgNorm && c.in_amps === device.in_amps && c.icu_ka) {
          return true;
        }
        return false;
      });

      if (cached && cached.icu_ka) {
        // IMPORTANT: Le cache ne doit enrichir que les valeurs MANQUANTES
        // Ne JAMAIS écraser les valeurs détectées par l'IA !
        // Le cache est utile pour icu_ka (rarement visible sur photos)
        // mais NE PAS utiliser pour in_amps, poles qui doivent venir de l'analyse photo
        const enriched = {
          ...device,
          // Icu/Ics: souvent pas visible sur les photos, cache utile
          icu_ka: device.icu_ka || cached.icu_ka,
          ics_ka: device.ics_ka || cached.ics_ka,
          // Voltage: garder la valeur AI, sinon cache, sinon défaut
          voltage_v: device.voltage_v || cached.voltage_v || 230,
          // Courbe: garder la valeur AI si présente
          curve_type: device.curve_type || cached.curve_type,
          // ATTENTION: NE PAS utiliser le cache pour poles !
          // Les pôles DOIVENT venir de l'analyse photo (mono vs tri)
          // poles: device.poles - garder tel quel, pas de fallback cache
          from_cache: true,
          cache_validated: cached.validated,
          selected: true
        };
        console.log(`[PANEL SCAN] Cache enrichment for ${device.reference}: Icu=${enriched.icu_ka}kA (AI poles=${device.poles} preserved)`);
        return enriched;
      }

      // Pas dans le cache - marquer pour enrichissement
      devicesToEnrich.push({ index: idx, device });

      // Valeurs par défaut en attendant
      return {
        ...device,
        icu_ka: device.icu_ka || null,
        voltage_v: device.voltage_v || 230,
        from_cache: false,
        selected: true
      };
    });

    // Si des appareils n'ont pas d'Icu, faire un enrichissement IA groupé
    const unknownDevices = result.devices.filter(d => !d.icu_ka && d.reference);
    if (unknownDevices.length > 0 && unknownDevices.length <= 10 && openai) {
      job.progress = 70;
      job.message = `Recherche specs pour ${unknownDevices.length} références inconnues...`;

      try {
        const enrichPrompt = unknownDevices.map(d =>
          `- ${d.manufacturer || '?'} ${d.reference || '?'} ${d.in_amps || '?'}A`
        ).join('\n');

        const specsResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Tu es un expert en appareillage électrique. Pour chaque disjoncteur, donne son Icu (pouvoir de coupure) en kA.
Utilise tes connaissances des catalogues Schneider, Hager, Legrand, ABB, Siemens.

Réponds en JSON: { "specs": [ { "reference": "...", "icu_ka": number, "curve_type": "B/C/D" } ] }`
            },
            { role: 'user', content: `Donne l'Icu pour ces disjoncteurs:\n${enrichPrompt}` }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
          temperature: 0.1
        });

        const enriched = JSON.parse(specsResponse.choices[0].message.content);

        // Appliquer les specs enrichies et sauvegarder dans le cache
        if (enriched.specs && Array.isArray(enriched.specs)) {
          for (const spec of enriched.specs) {
            const deviceIdx = result.devices.findIndex(d =>
              normalizeRef(d.reference) === normalizeRef(spec.reference)
            );
            if (deviceIdx >= 0 && spec.icu_ka) {
              result.devices[deviceIdx].icu_ka = spec.icu_ka;
              result.devices[deviceIdx].curve_type = result.devices[deviceIdx].curve_type || spec.curve_type;
              result.devices[deviceIdx].enriched_by_ai = true;

              // Sauvegarder dans le cache pour la prochaine fois
              const d = result.devices[deviceIdx];
              try {
                const normalizedRef = normalizeRef(d.reference);
                if (!normalizedRef) continue; // Skip if no valid reference
                await quickQuery(`
                  INSERT INTO scanned_products (site, reference, manufacturer, in_amps, icu_ka, curve_type, poles, voltage_v, source, scan_count)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'panel_scan_ai', 1)
                  ON CONFLICT (site, reference) DO UPDATE SET
                    icu_ka = COALESCE(scanned_products.icu_ka, EXCLUDED.icu_ka),
                    curve_type = COALESCE(scanned_products.curve_type, EXCLUDED.curve_type),
                    scan_count = scanned_products.scan_count + 1,
                    last_scanned_at = NOW()
                `, [site, normalizedRef, d.manufacturer, d.in_amps, spec.icu_ka, spec.curve_type, d.poles, d.voltage_v]);
                console.log(`[PANEL SCAN] Cached new product: ${d.reference} Icu=${spec.icu_ka}kA`);
              } catch (e) { /* ignore cache errors */ }
            }
          }
        }
      } catch (enrichErr) {
        console.warn('[PANEL SCAN] AI enrichment failed:', enrichErr.message);
      }
    }

    // ============================================================
    // PHASE 6: Cross-validation listing vs panel photos
    // ============================================================
    job.progress = 85;
    job.message = 'Validation croisée listing / photos...';

    let listingValidation = { used: false, matches: 0, mismatches: 0, corrections: 0 };

    if (listingData && listingData.length > 0) {
      console.log(`\n[PANEL SCAN] ${'─'.repeat(50)}`);
      console.log(`[PANEL SCAN] PHASE 6: Cross-Validation Listing vs Panel Photos`);
      console.log(`[PANEL SCAN] ${'─'.repeat(50)}`);

      listingValidation.used = true;
      listingValidation.listing_entries = listingData.length;

      // Build listing lookup by position
      const listingByPosition = {};
      for (const entry of listingData) {
        if (entry.position) {
          listingByPosition[entry.position] = entry;
        }
      }

      let validationMatches = 0;
      let validationMismatches = 0;
      let validationCorrections = [];

      result.devices = result.devices.map(device => {
        const position = device.position_label || device.position;
        const listingEntry = listingByPosition[position];

        if (!listingEntry) {
          return device; // No listing data for this position
        }

        const validation = {
          position,
          listing: { poles: listingEntry.poles, in_amps: listingEntry.in_amps },
          panel_ai: { poles: device.poles, in_amps: device.in_amps },
          matches: { poles: true, in_amps: true },
          corrected: false
        };

        // Check poles mismatch
        if (listingEntry.poles && device.poles && listingEntry.poles !== device.poles) {
          validation.matches.poles = false;
          validationMismatches++;
          console.log(`[PANEL SCAN] ⚠️  POLES MISMATCH ${position}: listing=${listingEntry.poles}P, panel=${device.poles}P → Using listing`);
          device.poles = listingEntry.poles; // Listing is authoritative for poles
          device.poles_source = 'listing';
          validation.corrected = true;
        } else if (listingEntry.poles) {
          device.poles = listingEntry.poles;
          device.poles_source = 'listing_confirmed';
        }

        // Check in_amps mismatch (tolerate small differences)
        const listingAmps = parseInt(listingEntry.in_amps);
        const panelAmps = parseInt(device.in_amps);
        if (listingAmps && panelAmps && listingAmps !== panelAmps) {
          validation.matches.in_amps = false;
          validationMismatches++;
          console.log(`[PANEL SCAN] ⚠️  AMPS MISMATCH ${position}: listing=${listingAmps}A, panel=${panelAmps}A → Keep panel (photo is authoritative)`);
          // For amps, the physical panel photo is more authoritative
          device.in_amps_listing = listingAmps;
          device.in_amps_mismatch = true;
        } else if (listingAmps && !panelAmps) {
          // Panel didn't detect, use listing
          device.in_amps = listingAmps;
          device.in_amps_source = 'listing';
        }

        if (validation.matches.poles && validation.matches.in_amps) {
          validationMatches++;
        }

        // Add designation from listing if missing
        if (!device.circuit_name && listingEntry.designation) {
          device.circuit_name = listingEntry.designation;
        }

        device.validation = validation;
        return device;
      });

      listingValidation.matches = validationMatches;
      listingValidation.mismatches = validationMismatches;
      console.log(`[PANEL SCAN] Cross-validation: ${validationMatches} matches, ${validationMismatches} corrections`);
    }

    job.progress = 88;
    job.message = 'Vérification des appareils existants...';

    // Charger les appareils existants du tableau pour marquer lesquels seront mis à jour vs créés
    let existingDevices = [];
    if (switchboardId) {
      try {
        const { rows } = await quickQuery(
          'SELECT id, position_number, reference, manufacturer, in_amps, name FROM devices WHERE switchboard_id = $1 AND site = $2',
          [switchboardId, site]
        );
        existingDevices = rows;
        console.log(`[PANEL SCAN] Found ${existingDevices.length} existing devices in switchboard`);
      } catch (e) { console.warn('[PANEL SCAN] Failed to load existing devices:', e.message); }
    }

    // Marquer chaque appareil scanné: exists_in_db, will_update, matching_device_id
    let willUpdateCount = 0;
    let willCreateCount = 0;
    result.devices = result.devices.map(device => {
      const positionNumber = device.position_label || device.position;
      const deviceRefNorm = normalizeRef(device.reference);

      const matchingDevice = existingDevices.find(e => {
        // Match par position exacte
        if (e.position_number && positionNumber && e.position_number === positionNumber) return true;

        // Match par référence normalisée + ampérage
        const existingRefNorm = normalizeRef(e.reference);
        if (existingRefNorm && deviceRefNorm &&
            (existingRefNorm === deviceRefNorm ||
             existingRefNorm.includes(deviceRefNorm) ||
             deviceRefNorm.includes(existingRefNorm)) &&
            Number(e.in_amps) === Number(device.in_amps)) {
          return true;
        }
        return false;
      });

      if (matchingDevice) {
        willUpdateCount++;
        return {
          ...device,
          exists_in_db: true,
          will_update: true,
          matching_device_id: matchingDevice.id,
          matching_device_name: matchingDevice.name
        };
      } else {
        willCreateCount++;
        return {
          ...device,
          exists_in_db: false,
          will_update: false
        };
      }
    });

    job.progress = 90;
    job.message = 'Finalisation...';

    // Debug: Log final values
    const finalValues = result.devices?.map(d => ({
      pos: d.position_label,
      ref: d.reference,
      icu: d.icu_ka,
      fromCache: d.from_cache,
      willUpdate: d.will_update
    })) || [];
    // Job complete
    job.status = 'completed';
    job.progress = 100;
    job.message = `${deviceCount} appareils détectés !`;
    job.result = {
      ...result,
      photos_analyzed: images.length,
      analysis_version: '1.2',
      summary: {
        total_detected: deviceCount,
        will_create: willCreateCount,
        will_update: willUpdateCount,
        existing_in_switchboard: existingDevices.length,
        listing_validation: listingValidation
      }
    };
    job.completed_at = Date.now();
    const totalDuration = Date.now() - startTime;

    // Final summary log
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[PANEL SCAN] JOB ${jobId} COMPLETED SUCCESSFULLY`);
    console.log(`${'='.repeat(70)}`);
    console.log(`[PANEL SCAN] ⏱️  Total duration: ${Math.round(totalDuration / 1000)}s`);
    console.log(`[PANEL SCAN] 📷 Photos analyzed: ${images.length}`);
    console.log(`[PANEL SCAN] 🔍 Devices detected: ${deviceCount}`);
    console.log(`[PANEL SCAN]    ├─ To create: ${willCreateCount}`);
    console.log(`[PANEL SCAN]    ├─ To update: ${willUpdateCount}`);
    console.log(`[PANEL SCAN]    └─ Already exist: ${existingDevices.length}`);
    console.log(`${'='.repeat(70)}\n`);

    // Sauvegarder les photos du scan dans la galerie
    try {
      for (let i = 0; i < images.length; i++) {
        const imageData = images[i];
        // Convertir base64 en buffer si nécessaire
        let photoBuffer;
        if (typeof imageData === 'string') {
          // C'est du base64
          const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
          photoBuffer = Buffer.from(base64Data, 'base64');
        } else if (Buffer.isBuffer(imageData)) {
          photoBuffer = imageData;
        } else {
          continue; // Format non supporté
        }

        await quickQuery(`
          INSERT INTO switchboard_photos (site, switchboard_id, photo, source, description, created_by)
          VALUES ($1, $2, $3, 'panel_scan', $4, $5)
        `, [
          site,
          switchboardId,
          photoBuffer,
          `Scan du ${new Date().toLocaleDateString('fr-FR')} - Photo ${i + 1}/${images.length}`,
          userEmail
        ]);
      }
      console.log(`[PANEL SCAN] 💾 ${images.length} photos sauvegardées dans la galerie`);
    } catch (photoErr) {
      console.warn('[PANEL SCAN] Failed to save photos to gallery:', photoErr.message);
    }

    // Send push notification (only once)
    if (userEmail && !job.notified) {
      job.notified = true;
      try {
        const { notifyUser } = await import('./lib/push-notify.js');
        await notifyUser(userEmail,
          '📋 Scan tableau terminé',
          `${deviceCount} appareil${deviceCount > 1 ? 's' : ''} détecté${deviceCount > 1 ? 's' : ''} !`,
          {
            type: 'panel_scan_complete',
            tag: `panel-scan-${jobId}`,
            data: {
              jobId,
              switchboardId,
              deviceCount,
              url: `/app/switchboards?scanJobId=${jobId}&switchboardId=${switchboardId}`
            }
          }
        );
      } catch (e) {
        console.warn('[PANEL SCAN] Push notification failed:', e.message);
      }
    }

    // Save completed job to database for persistence
    await savePanelScanJob(job);

    // 📝 AUDIT: Log fin du scan avec les résultats
    try {
      const mockReq = {
        user: { email: userEmail, name: userEmail?.split('@')[0] },
        headers: { 'x-site': site },
        ip: null
      };
      await audit.log(mockReq, 'panel_scan_completed', {
        entityType: 'switchboard',
        entityId: switchboardId,
        details: {
          jobId,
          photos_analyzed: images.length,
          devices_detected: deviceCount,
          devices_to_create: willCreateCount,
          devices_to_update: willUpdateCount,
          duration_seconds: Math.round(totalDuration / 1000),
          site
        }
      });
    } catch (auditErr) {
      console.warn('[PANEL SCAN] Audit log failed (non-blocking):', auditErr.message);
    }

  } catch (error) {
    const errorDuration = Date.now() - (job.created_at || Date.now());
    console.error(`\n${'='.repeat(70)}`);
    console.error(`[PANEL SCAN] ❌ JOB ${jobId} FAILED`);
    console.error(`${'='.repeat(70)}`);
    console.error(`[PANEL SCAN] Error: ${error.message}`);
    console.error(`[PANEL SCAN] Duration before failure: ${Math.round(errorDuration / 1000)}s`);
    console.error(`[PANEL SCAN] Stack trace:`);
    console.error(error.stack?.split('\n').slice(0, 5).join('\n'));
    console.error(`${'='.repeat(70)}\n`);

    job.status = 'failed';
    job.progress = 0;
    job.message = error.message;
    job.error = error.message;
    job.completed_at = Date.now();

    // Notify failure (only once)
    if (userEmail && !job.notified) {
      job.notified = true;
      try {
        const { notifyUser } = await import('./lib/push-notify.js');
        await notifyUser(userEmail,
          '❌ Erreur scan tableau',
          `L'analyse a échoué: ${error.message}`,
          { type: 'panel_scan_failed', tag: `panel-scan-${jobId}`, data: { jobId } }
        );
      } catch (e) { /* ignore */ }
    }

    // Save failed job to database for persistence
    await savePanelScanJob(job);
  } finally {
    job.processing = false;
  }
}

// ============================================================
// POST /api/switchboard/analyze-listing - Analyze switchboard listing photos
// Extract reference data (position, designation, protection, poles, amps)
// ============================================================
app.post('/api/switchboard/analyze-listing', upload.array('photos', 10), async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { switchboard_id } = req.body;
    const user = getUser(req);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune photo de listing fournie' });
    }
    if (!openai) {
      return res.status(503).json({ error: 'OpenAI non disponible' });
    }
    if (!switchboard_id) {
      return res.status(400).json({ error: 'switchboard_id requis' });
    }

    console.log(`[LISTING SCAN] Analyzing ${req.files.length} listing photo(s) for switchboard ${switchboard_id}`);

    // Prepare images
    const images = req.files.map(file => ({
      type: 'image_url',
      image_url: {
        url: `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`,
        detail: 'high'
      }
    }));

    // Prompt spécialisé pour les listings
    const listingPrompt = `Tu es un expert en lecture de tableaux électriques et de leurs listings/nomenclatures.

Analyse cette/ces photo(s) de LISTING (document papier/tableau de nomenclature) d'un tableau électrique.

OBJECTIF: Extraire la liste des équipements avec leurs caractéristiques depuis ce document écrit.

COLONNES TYPIQUES D'UN LISTING:
- Repère départ / Position / N° (ex: "11F1", "11F2", "Q1", "1", "2"...)
- Désignation / Circuit / Nom (ex: "Éclairage bureau", "Prises RDC", "Chauffage"...)
- Protection / Calibre (ex: "16A", "3x16A", "4x32A", "C16"...)

🚨 RÈGLE CRITIQUE - FORMAT DES PÔLES DANS LA COLONNE PROTECTION:
Le nombre de pôles est SOUVENT encodé dans le calibre avec le format "NxAA" où N = nombre de pôles:
- "16A" ou "C16" = 1 pôle (monophasé)
- "2x16A" = 2 pôles
- "3x16A" ou "3x32A" = 3 pôles (triphasé)
- "4x25A" ou "4x63A" = 4 pôles (tétrapolaire)

Exemples de lecture:
| Protection | → poles | → in_amps |
|------------|---------|-----------|
| 16A        | 1       | 16        |
| C16        | 1       | 16        |
| 3x16A      | 3       | 16        |
| 4x32A      | 4       | 32        |
| 3x63A      | 3       | 63        |
| 2x20A      | 2       | 20        |
| 1P 16A     | 1       | 16        |
| 3P 32A     | 3       | 32        |

INSTRUCTIONS:
1. Lis CHAQUE ligne du tableau/listing visible
2. Extrait les informations de CHAQUE équipement
3. DÉDUIS le nombre de pôles depuis le format NxAA ou NP !
4. Si une colonne n'existe pas ou n'est pas lisible, mets null

IMPORTANT:
- Le repère/position est CRUCIAL - c'est ce qui permet de faire le lien avec le tableau physique
- La désignation aide à comprendre l'usage du circuit
- Le nombre de pôles est DÉDUIT du format "NxAA" (ex: 3x16A = 3 pôles)

Réponds en JSON:
{
  "listing_type": "nomenclature/tableau/étiquettes/autre",
  "total_entries": number,
  "entries": [
    {
      "position": "11F1",
      "designation": "Éclairage bureau 1",
      "poles": 1,
      "poles_text": "16A",
      "in_amps": 16,
      "protection_text": "16A",
      "icu_ka": null,
      "curve_type": "C",
      "is_differential": false,
      "notes": ""
    },
    {
      "position": "11F5",
      "designation": "Four",
      "poles": 3,
      "poles_text": "3x32A",
      "in_amps": 32,
      "protection_text": "3x32A",
      "icu_ka": null,
      "curve_type": "C",
      "is_differential": false,
      "notes": ""
    }
  ],
  "reading_confidence": "high/medium/low",
  "notes": "Observations sur le document"
}`;

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: listingPrompt },
        { role: 'user', content: images }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.1
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`[LISTING SCAN] Extracted ${result.entries?.length || 0} entries from listing`);

    // Normalize and validate entries
    const normalizedEntries = (result.entries || []).map(entry => ({
      position: entry.position?.toString().trim() || null,
      designation: entry.designation?.trim() || null,
      poles: parseInt(entry.poles) || null,
      poles_text: entry.poles_text || null,
      in_amps: parseInt(entry.in_amps) || null,
      icu_ka: parseFloat(entry.icu_ka) || null,
      curve_type: entry.curve_type || null,
      is_differential: !!entry.is_differential,
      notes: entry.notes || null
    })).filter(e => e.position); // Only keep entries with position

    // Store listing data in switchboard settings for later use
    try {
      await quickQuery(`
        UPDATE switchboards
        SET settings = jsonb_set(
          COALESCE(settings, '{}'::jsonb),
          '{listing_data}',
          $2::jsonb
        ),
        updated_at = NOW()
        WHERE id = $1 AND site = $3
      `, [
        switchboard_id,
        JSON.stringify({
          entries: normalizedEntries,
          scanned_at: new Date().toISOString(),
          photos_count: req.files.length,
          confidence: result.reading_confidence,
          scanned_by: user.email
        }),
        site
      ]);
      console.log(`[LISTING SCAN] Saved ${normalizedEntries.length} entries to switchboard ${switchboard_id}`);
    } catch (dbErr) {
      console.warn('[LISTING SCAN] Failed to save listing data:', dbErr.message);
    }

    // Also pre-fill devices if they don't exist yet
    let devicesCreated = 0;
    let devicesUpdated = 0;
    for (const entry of normalizedEntries) {
      if (!entry.position) continue;
      try {
        const result = await quickQuery(`
          INSERT INTO devices (
            site, switchboard_id, name, device_type,
            in_amps, poles, voltage_v, curve_type, is_differential,
            position_number, is_complete, settings
          ) VALUES ($1, $2, $3, 'Disjoncteur modulaire', $4, $5, $6, $7, $8, $9, false, $10)
          ON CONFLICT (switchboard_id, position_number) DO UPDATE SET
            name = COALESCE(devices.name, EXCLUDED.name),
            in_amps = COALESCE(devices.in_amps, EXCLUDED.in_amps),
            poles = COALESCE(devices.poles, EXCLUDED.poles),
            voltage_v = COALESCE(devices.voltage_v, EXCLUDED.voltage_v),
            curve_type = COALESCE(devices.curve_type, EXCLUDED.curve_type),
            is_differential = COALESCE(devices.is_differential, EXCLUDED.is_differential),
            settings = jsonb_set(
              COALESCE(devices.settings, '{}'::jsonb),
              '{listing_data}',
              EXCLUDED.settings->'listing_data'
            ),
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `, [
          site,
          switchboard_id,
          entry.designation || `Circuit ${entry.position}`,
          entry.in_amps,
          entry.poles || 1,
          entry.poles && entry.poles >= 3 ? 400 : 230,
          entry.curve_type,
          entry.is_differential,
          entry.position,
          JSON.stringify({ listing_data: entry, from_listing: true })
        ]);
        if (result.rows[0]?.inserted) {
          devicesCreated++;
        } else {
          devicesUpdated++;
        }
      } catch (e) {
        console.warn(`[LISTING SCAN] Failed to create/update device ${entry.position}:`, e.message);
      }
    }

    console.log(`[LISTING SCAN] Created ${devicesCreated}, updated ${devicesUpdated} devices from listing`);

    // Recalculer les compteurs du tableau après les opérations bulk
    await quickQuery(`
      UPDATE switchboards SET
        device_count = (SELECT COUNT(*) FROM devices WHERE switchboard_id = $1),
        complete_count = (SELECT COUNT(*) FROM devices WHERE switchboard_id = $1 AND is_complete = true),
        updated_at = NOW()
      WHERE id = $1
    `, [switchboard_id]);

    res.json({
      success: true,
      listing_type: result.listing_type,
      total_entries: normalizedEntries.length,
      entries: normalizedEntries,
      devices_created: devicesCreated,
      devices_updated: devicesUpdated,
      confidence: result.reading_confidence,
      notes: result.notes,
      message: `${normalizedEntries.length} équipements extraits du listing`
    });

  } catch (e) {
    console.error('[LISTING SCAN] Error:', e.message);
    res.status(500).json({ error: 'Erreur analyse listing: ' + e.message });
  }
});

// POST /api/switchboard/analyze-panel - Start async analysis
app.post('/api/switchboard/analyze-panel', upload.array('photos', 15), async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { switchboard_id } = req.body;
    const user = getUser(req);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune photo fournie' });
    }
    if (!openai) {
      return res.status(503).json({ error: 'OpenAI non disponible' });
    }

    // ============================================================
    // NOTE: Parallel scans allowed on same switchboard
    // Multiple scans can now run simultaneously on the same tableau
    // ============================================================

    // Create job ID
    const jobId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[PANEL SCAN] Creating job ${jobId} for ${req.files.length} photo(s)`);

    // Prepare images in base64
    const images = req.files.map(file => {
      const base64Image = file.buffer.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      return { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' };
    });

    // Create job
    const job = {
      id: jobId,
      site: site,
      status: 'pending',
      progress: 0,
      message: 'En file d\'attente...',
      switchboard_id: switchboard_id,
      photos_count: req.files.length,
      created_at: Date.now(),
      user_email: user.email
    };
    panelScanJobs.set(jobId, job);

    // Save to database for persistence WITH IMAGES for resume capability
    await savePanelScanJob(job, images);

    // 📝 AUDIT: Log démarrage du scan
    await audit.log(req, 'panel_scan_started', {
      entityType: 'switchboard',
      entityId: switchboard_id,
      details: {
        jobId,
        photos_count: req.files.length,
        site
      }
    });

    // Return immediately with job ID
    res.json({
      job_id: jobId,
      status: 'pending',
      message: 'Analyse démarrée en arrière-plan',
      poll_url: `/api/switchboard/panel-scan-job/${jobId}`
    });

    // Start processing in background (after response is sent)
    // Use setImmediate to ensure response is sent first, then process
    setImmediate(async () => {
      try {
        console.log(`[PANEL SCAN] Background processing started for job ${jobId}`);
        await processPanelScan(jobId, images, site, switchboard_id, user.email);
        console.log(`[PANEL SCAN] Background processing finished for job ${jobId}`);
      } catch (bgError) {
        console.error(`[PANEL SCAN] Background processing error for job ${jobId}:`, bgError.message);
        // Update job status on error
        const failedJob = panelScanJobs.get(jobId);
        if (failedJob) {
          failedJob.status = 'failed';
          failedJob.error = bgError.message;
          failedJob.completed_at = Date.now();
          await savePanelScanJob(failedJob);
        }
      }
    });

  } catch (e) {
    console.error('[PANEL SCAN] Error:', e.message);
    res.status(500).json({ error: 'Panel analysis failed: ' + e.message });
  }
});

// GET /api/switchboard/panel-scan-job/:id - Get job status/result
app.get('/api/switchboard/panel-scan-job/:id', async (req, res) => {
  // Try memory cache first, then database
  let job = panelScanJobs.get(req.params.id);

  if (!job) {
    // Load from database for persistence
    console.log(`[PANEL SCAN] Job ${req.params.id} not in memory, checking database...`);
    job = await loadPanelScanJob(req.params.id);

    if (job) {
      console.log(`[PANEL SCAN] Job ${req.params.id} loaded from database (status: ${job.status})`);
      // Cache it in memory for subsequent requests
      panelScanJobs.set(req.params.id, job);
    }
  }

  if (!job) {
    return res.status(404).json({ error: 'Job non trouvé - il a peut-être expiré' });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    switchboard_id: job.switchboard_id,
    photos_count: job.photos_count,
    created_at: job.created_at,
    completed_at: job.completed_at,
    result: job.result,
    error: job.error
  });

  // Debug: Log sent icu_ka values when job is completed
  if (job.status === 'completed' && job.result?.devices) {
    const sentIcu = job.result.devices.map(d => ({ pos: d.position_label, icu: d.icu_ka }));
    console.log(`[PANEL SCAN] Sent to frontend:`, JSON.stringify(sentIcu));
  }
});

// DELETE /api/switchboard/panel-scan-job/:id - Cancel or delete a job
app.delete('/api/switchboard/panel-scan-job/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    const user = getUser(req);

    // Remove from memory
    panelScanJobs.delete(jobId);

    // Mark as cancelled in database
    await pool.query(`
      UPDATE panel_scan_jobs
      SET status = 'cancelled',
          error = 'Annulé par l\\'utilisateur',
          completed_at = NOW()
      WHERE id = $1
    `, [jobId]);

    console.log(`[PANEL SCAN] Job ${jobId} cancelled by ${user.email}`);
    res.json({ success: true, message: 'Job annulé' });
  } catch (e) {
    console.error('[PANEL SCAN] Cancel error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/switchboard/panel-scan-jobs - List recent panel scan jobs for user
app.get('/api/switchboard/panel-scan-jobs', async (req, res) => {
  try {
    const user = getUser(req);
    const userEmail = user.email;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    // Get recent jobs from database
    const result = await pool.query(`
      SELECT
        j.id, j.site, j.switchboard_id, j.user_email, j.status, j.progress, j.message,
        j.photos_count, j.error,
        EXTRACT(EPOCH FROM j.created_at) * 1000 as created_at,
        EXTRACT(EPOCH FROM j.completed_at) * 1000 as completed_at,
        j.result->'summary' as summary,
        s.name as switchboard_name,
        s.code as switchboard_code,
        s.building_code
      FROM panel_scan_jobs j
      LEFT JOIN switchboards s ON j.switchboard_id = s.id
      WHERE ($1::text IS NULL OR LOWER(j.user_email) = LOWER($1))
      ORDER BY j.created_at DESC
      LIMIT $2
    `, [userEmail, limit]);

    res.json({
      jobs: result.rows.map(row => ({
        id: row.id,
        switchboard_id: row.switchboard_id,
        switchboard_name: row.switchboard_name,
        switchboard_code: row.switchboard_code,
        building_code: row.building_code,
        status: row.status,
        progress: row.progress,
        message: row.message,
        photos_count: row.photos_count,
        summary: row.summary,
        error: row.error,
        created_at: parseInt(row.created_at),
        completed_at: row.completed_at ? parseInt(row.completed_at) : null,
        url: row.status === 'completed' && row.switchboard_id
          ? `/app/switchboards?scanJobId=${row.id}&switchboardId=${row.switchboard_id}`
          : null
      })),
      total: result.rows.length
    });
  } catch (e) {
    console.error('[PANEL SCAN JOBS LIST]', e.message);
    res.status(500).json({ error: 'Failed to list panel scan jobs' });
  }
});

// POST /api/switchboard/devices/bulk - Création en masse de disjoncteurs
app.post('/api/switchboard/devices/bulk', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { switchboard_id, devices } = req.body;
    const user = getUser(req);

    if (!switchboard_id) return res.status(400).json({ error: 'switchboard_id requis' });
    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'devices array requis' });
    }

    console.log(`[BULK CREATE] Processing ${devices.length} devices for switchboard ${switchboard_id}`);

    // Helper function to parse in_amps from AI output (handles "250A", "C16", "C63", etc.)
    const parseInAmps = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        // Remove common suffixes/prefixes: "A", "C", "B", "D", "K", "Z" (curve types)
        const cleaned = value.replace(/^[CBDKZ]/i, '').replace(/A$/i, '').trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      }
      return null;
    };

    // Helper function to parse icu_ka (handles "6kA", "10000", etc.)
    const parseIcuKa = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        // Handle "6kA", "10kA", "6000", "10000"
        let cleaned = value.replace(/kA$/i, '').replace(/A$/i, '').trim();
        let num = parseFloat(cleaned);
        if (isNaN(num)) return null;
        // If value > 100, assume it's in Amps, convert to kA
        if (num > 100) num = num / 1000;
        return num;
      }
      return null;
    };

    // Vérifier que le tableau existe et charger les données du listing si disponibles
    const { rows: [board] } = await quickQuery(
      'SELECT id, name, settings FROM switchboards WHERE id = $1 AND site = $2',
      [switchboard_id, site]
    );
    if (!board) return res.status(404).json({ error: 'Tableau non trouvé' });

    // Extraire les données du listing (si photo listing scannée avant)
    const listingData = board.settings?.listing_data?.entries || [];
    const listingByPosition = {};
    for (const entry of listingData) {
      if (entry.position) {
        listingByPosition[entry.position] = entry;
      }
    }
    if (listingData.length > 0) {
      console.log(`[BULK CREATE] Listing data available: ${listingData.length} entries`);
    }

    // Charger les appareils existants pour ce tableau (pour éviter les doublons)
    const { rows: existingDevices } = await quickQuery(
      'SELECT id, position_number, reference, manufacturer, in_amps FROM devices WHERE switchboard_id = $1 AND site = $2',
      [switchboard_id, site]
    );
    console.log(`[BULK CREATE] Found ${existingDevices.length} existing devices`);

    // Build a Map of existing devices by normalized position for O(1) lookup
    const existingByPosition = new Map();
    for (const dev of existingDevices) {
      if (dev.position_number != null) {
        const normalizedPos = String(dev.position_number).trim();
        existingByPosition.set(normalizedPos, dev);
      }
    }

    // Debug: log existing positions for troubleshooting
    if (existingDevices.length > 0) {
      const existingPositions = Array.from(existingByPosition.keys()).join(', ');
      console.log(`[BULK CREATE] Existing positions: [${existingPositions}]`);
    }

    const createdDevices = [];
    const updatedDevices = [];
    const errors = [];

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      try {
        // Utiliser position_label comme position_number
        const positionNumber = device.position_label || device.position || String(i + 1);

        // ============================================================
        // PARSING PRÉALABLE - Convertir toutes les valeurs AI en types corrects
        // ============================================================
        const parsedIcu = parseIcuKa(device.icu_ka);
        const parsedIcs = parseIcuKa(device.ics_ka);

        // ============================================================
        // INFÉRENCE DES PÔLES - Basée sur listing, width_modules et référence
        // ============================================================
        const inferPoles = (dev, position) => {
          // PRIORITÉ 1: Données du listing (document papier scanné)
          const listingEntry = listingByPosition[position];
          if (listingEntry?.poles && listingEntry.poles >= 1 && listingEntry.poles <= 4) {
            console.log(`[BULK CREATE] Poles from listing for ${position}: ${listingEntry.poles}P`);
            return listingEntry.poles;
          }

          // PRIORITÉ 2: Valeur AI si valide
          const rawPoles = typeof dev.poles === 'number' ? dev.poles :
                          typeof dev.poles === 'string' ? parseInt(dev.poles) : null;
          if (rawPoles && rawPoles >= 1 && rawPoles <= 4) {
            return rawPoles;
          }

          // PRIORITÉ 3: Inférer depuis width_modules (très fiable)
          const width = dev.width_modules;
          if (width) {
            // 1 module = 1P, 2 modules = 1P+N ou 2P, 3 modules = 3P, 4 modules = 3P+N ou 4P
            if (width === 1) return 1;
            if (width === 2) return 2; // 1P+N compte comme 2P
            if (width === 3) return 3;
            if (width >= 4) return 4;
          }

          // PRIORITÉ 4: Inférer depuis la référence du produit
          const ref = (dev.reference || '').toUpperCase();
          // Références Schneider avec indication de pôles
          if (ref.match(/3P\+N|4P|3PN/)) return 4;
          if (ref.match(/3P(?!N)/)) return 3;
          if (ref.match(/2P|1P\+N|1PN/)) return 2;
          if (ref.match(/1P(?!N)/)) return 1;

          // PRIORITÉ 5: Inférer depuis la tension
          const voltage = dev.voltage_v;
          if (voltage === 400 || voltage === '400' || voltage === '400V') return 3; // Triphasé = minimum 3P
          if (voltage === 230 || voltage === '230' || voltage === '230V') return 1; // Monophasé = 1P par défaut

          // PRIORITÉ 6: Défaut basé sur le type d'appareil
          const deviceType = (dev.device_type || '').toLowerCase();
          if (deviceType.includes('disjoncteur') && !deviceType.includes('différentiel')) {
            return 1;
          }
          // Interrupteurs différentiels: généralement 2P ou 4P
          if (deviceType.includes('différentiel') || deviceType.includes('inter diff')) {
            return 2;
          }

          return 1; // Défaut ultime
        };

        // Fonction pour enrichir depuis le listing
        const enrichFromListing = (dev, position) => {
          const listingEntry = listingByPosition[position];
          if (!listingEntry) return dev;

          return {
            ...dev,
            // Priorité aux données AI, fallback sur listing
            circuit_name: dev.circuit_name || listingEntry.designation,
            name: dev.name || listingEntry.designation,
            in_amps: dev.in_amps || listingEntry.in_amps,
            curve_type: dev.curve_type || listingEntry.curve_type,
            is_differential: dev.is_differential || listingEntry.is_differential,
            icu_ka: dev.icu_ka || listingEntry.icu_ka,
            // Flag pour traçabilité
            _enriched_from_listing: true
          };
        };

        // ============================================================
        // INFÉRENCE DE LA TENSION - Basée sur les pôles
        // ============================================================
        const inferVoltage = (dev, poles) => {
          const rawVoltage = typeof dev.voltage_v === 'number' ? dev.voltage_v :
                            typeof dev.voltage_v === 'string' ? parseInt(dev.voltage_v) : null;
          if (rawVoltage && rawVoltage > 0) return rawVoltage;

          // Inférer depuis les pôles
          if (poles >= 3) return 400; // Triphasé
          return 230; // Monophasé
        };

        // ============================================================
        // INFÉRENCE DU TYPE DE DÉCLENCHEUR
        // ============================================================
        const inferTripUnit = (dev) => {
          if (dev.trip_unit) return dev.trip_unit;
          const deviceType = (dev.device_type || '').toLowerCase();
          const reference = (dev.reference || '').toLowerCase();

          // Interrupteurs différentiels n'ont pas de déclencheur
          if (deviceType.includes('interrupteur différentiel') ||
              deviceType.includes('inter diff') ||
              reference.match(/^i?id/i)) {
            return null;
          }
          // Contacteurs, télérupteurs n'ont pas de déclencheur
          if (deviceType.includes('contacteur') || deviceType.includes('télérupteur')) {
            return null;
          }
          // Disjoncteurs industriels avec Micrologic
          if (reference.includes('micrologic') || deviceType.includes('micrologic')) {
            return 'électronique';
          }
          // Disjoncteurs industriels NSX, Masterpact, etc.
          if (reference.match(/nsx|masterpact|tmax|nzm|dpx/i)) {
            return 'thermique-magnétique réglable';
          }
          // Disjoncteurs modulaires par défaut
          if (deviceType.includes('disjoncteur')) {
            return 'thermique-magnétique';
          }
          return null;
        };

        // Enrichir depuis le listing si disponible (nom circuit, intensité, etc.)
        const enrichedDevice = enrichFromListing(device, positionNumber);

        // Inférer les pôles (avec priorité au listing)
        const inferredPoles = inferPoles(enrichedDevice, positionNumber);
        const inferredVoltage = inferVoltage(enrichedDevice, inferredPoles);

        const parsedDevice = {
          ...enrichedDevice,
          in_amps: parseInAmps(enrichedDevice.in_amps),
          icu_ka: parsedIcu || parseIcuKa(enrichedDevice.icu_ka),
          // Ics = Icu pour tous les disjoncteurs (100% pour modulaires)
          ics_ka: parsedIcs || parsedIcu || parseIcuKa(enrichedDevice.icu_ka),
          // Pôles inférés intelligemment (listing > AI > width > référence > tension)
          poles: inferredPoles,
          // Tension basée sur les pôles
          voltage_v: inferredVoltage,
          // Type de déclencheur inféré
          trip_unit: inferTripUnit(enrichedDevice),
        };

        // ============================================================
        // VALIDATION - Ne pas créer de devices complètement vides
        // ============================================================
        const hasMinimumData = parsedDevice.manufacturer || parsedDevice.reference ||
                               parsedDevice.in_amps || parsedDevice.device_type;
        if (!hasMinimumData) {
          console.log(`[BULK CREATE] Skipping empty device at position ${positionNumber}`);
          continue; // Skip this device
        }

        // Log pour debug
        if (i < 5 || parsedDevice.in_amps !== parseInAmps(device.in_amps)) {
          console.log(`[BULK CREATE] Device ${positionNumber}: in_amps="${device.in_amps}" → ${parsedDevice.in_amps}, poles=${parsedDevice.poles}, icu=${parsedDevice.icu_ka}`);
        }

        // Chercher si un appareil existe déjà à cette position
        const positionStr = String(positionNumber).trim();

        // PRIORITY 1: Exact position match using the Map (most reliable)
        let existingDevice = existingByPosition.get(positionStr);
        if (existingDevice) {
          console.log(`[BULK CREATE] Position ${positionStr}: found existing device ${existingDevice.id} by position`);
        }

        // PRIORITY 2: Match by reference + amperage (only if not found by position)
        if (!existingDevice) {
          const deviceRefNorm = normalizeRef(device.reference);
          existingDevice = existingDevices.find(e => {
            const existingRefNorm = normalizeRef(e.reference);
            // Match par référence normalisée + ampérage
            if (existingRefNorm && deviceRefNorm &&
                existingRefNorm === deviceRefNorm &&
                Number(e.in_amps) === parsedDevice.in_amps) {
              return true;
            }
            // Match partiel sur référence (ex: "ic60n" contient dans "a9f74216ic60n")
            if (existingRefNorm && deviceRefNorm &&
                (existingRefNorm.includes(deviceRefNorm) || deviceRefNorm.includes(existingRefNorm)) &&
                Number(e.in_amps) === parsedDevice.in_amps) {
              return true;
            }
            return false;
          });
          if (existingDevice) {
            console.log(`[BULK CREATE] Position ${positionStr}: found existing device ${existingDevice.id} by reference match`);
          }
        }

        if (existingDevice) {
          // Mettre à jour l'appareil existant avec les nouvelles infos
          // Compute is_complete for the merged device data - utiliser parsedDevice !
          const mergedDevice = {
            manufacturer: parsedDevice.manufacturer || existingDevice.manufacturer,
            reference: parsedDevice.reference || existingDevice.reference,
            in_amps: parsedDevice.in_amps || Number(existingDevice.in_amps) || null
          };
          const deviceIsComplete = checkDeviceComplete(mergedDevice);

          const { rows: [updated] } = await quickQuery(`
            UPDATE devices SET
              name = COALESCE($3, name),
              device_type = COALESCE($4, device_type),
              manufacturer = COALESCE($5, manufacturer),
              reference = COALESCE($6, reference),
              in_amps = COALESCE($7, in_amps),
              icu_ka = COALESCE($8, icu_ka),
              ics_ka = COALESCE($9, ics_ka),
              poles = COALESCE($10, poles),
              voltage_v = COALESCE($11, voltage_v),
              is_differential = COALESCE($12, is_differential),
              position_number = $13,
              curve_type = COALESCE($14, curve_type),
              differential_sensitivity_ma = COALESCE($15, differential_sensitivity_ma),
              differential_type = COALESCE($16, differential_type),
              trip_unit = COALESCE($17, trip_unit),
              is_complete = $18,
              settings = jsonb_set(
                COALESCE(settings, '{}'::jsonb),
                '{last_scan}',
                $19::jsonb
              ),
              updated_at = NOW()
            WHERE id = $1 AND site = $2
            RETURNING *
          `, [
            existingDevice.id,
            site,
            parsedDevice.circuit_name || parsedDevice.name,
            parsedDevice.device_type,
            parsedDevice.manufacturer,
            parsedDevice.reference,
            parsedDevice.in_amps,
            parsedDevice.icu_ka,
            parsedDevice.ics_ka,
            parsedDevice.poles,
            parsedDevice.voltage_v,
            parsedDevice.is_differential,
            positionNumber,
            parsedDevice.curve_type,
            parsedDevice.differential_sensitivity_ma,
            parsedDevice.differential_type,
            parsedDevice.trip_unit,
            deviceIsComplete,
            JSON.stringify({
              width_modules: parsedDevice.width_modules,
              scanned_at: new Date().toISOString(),
              source: 'panel_scan'
            })
          ]);
          console.log(`[BULK CREATE] Updated existing device ${existingDevice.id} at position ${positionNumber}`);
          updatedDevices.push(updated);
        } else {
          // Créer un nouvel appareil - utiliser parsedDevice !
          // ON CONFLICT pour éviter les doublons de position
          const newDeviceComplete = checkDeviceComplete(parsedDevice);
          const { rows: [created] } = await quickQuery(`
            INSERT INTO devices (
              site, switchboard_id, name, device_type, manufacturer, reference,
              in_amps, icu_ka, ics_ka, poles, voltage_v,
              is_differential, position_number, is_complete,
              curve_type, differential_sensitivity_ma, differential_type, trip_unit, settings
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (switchboard_id, position_number) DO UPDATE SET
              name = COALESCE(EXCLUDED.name, devices.name),
              device_type = COALESCE(EXCLUDED.device_type, devices.device_type),
              manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
              reference = COALESCE(EXCLUDED.reference, devices.reference),
              in_amps = COALESCE(EXCLUDED.in_amps, devices.in_amps),
              icu_ka = COALESCE(EXCLUDED.icu_ka, devices.icu_ka),
              ics_ka = COALESCE(EXCLUDED.ics_ka, devices.ics_ka),
              poles = COALESCE(EXCLUDED.poles, devices.poles),
              voltage_v = COALESCE(EXCLUDED.voltage_v, devices.voltage_v),
              is_differential = COALESCE(EXCLUDED.is_differential, devices.is_differential),
              is_complete = EXCLUDED.is_complete,
              curve_type = COALESCE(EXCLUDED.curve_type, devices.curve_type),
              differential_sensitivity_ma = COALESCE(EXCLUDED.differential_sensitivity_ma, devices.differential_sensitivity_ma),
              differential_type = COALESCE(EXCLUDED.differential_type, devices.differential_type),
              trip_unit = COALESCE(EXCLUDED.trip_unit, devices.trip_unit),
              settings = EXCLUDED.settings,
              updated_at = NOW()
            RETURNING *, (xmax = 0) AS inserted
          `, [
            site,
            switchboard_id,
            parsedDevice.circuit_name || parsedDevice.name || `${parsedDevice.device_type || 'Disjoncteur'} ${positionNumber}`,
            parsedDevice.device_type || 'Disjoncteur modulaire',
            parsedDevice.manufacturer,
            parsedDevice.reference,
            parsedDevice.in_amps,
            parsedDevice.icu_ka,
            parsedDevice.ics_ka,
            parsedDevice.poles,
            parsedDevice.voltage_v,
            parsedDevice.is_differential || false,
            positionNumber,
            newDeviceComplete,
            parsedDevice.curve_type || null,
            parsedDevice.differential_sensitivity_ma || null,
            parsedDevice.differential_type || null,
            parsedDevice.trip_unit || null,
            JSON.stringify({
              width_modules: parsedDevice.width_modules,
              scanned_at: new Date().toISOString(),
              source: 'panel_scan'
            })
          ]);
          if (created.inserted) {
            console.log(`[BULK CREATE] Created new device at position ${positionNumber} (complete: ${newDeviceComplete})`);
            createdDevices.push(created);
          } else {
            console.log(`[BULK CREATE] Updated existing device at position ${positionNumber} via ON CONFLICT`);
            updatedDevices.push(created);
          }
        }

        // Sauvegarder dans le cache des produits scannés si référence complète
        if (parsedDevice.manufacturer && parsedDevice.reference && parsedDevice.in_amps) {
          try {
            const normalizedRef = normalizeRef(parsedDevice.reference);
            if (!normalizedRef) continue; // Skip if no valid reference
            await quickQuery(`
              INSERT INTO scanned_products (site, reference, manufacturer, in_amps, icu_ka, ics_ka, poles, voltage_v, curve_type, source, scan_count)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'panel_scan', 1)
              ON CONFLICT (site, reference) DO UPDATE SET
                icu_ka = COALESCE(EXCLUDED.icu_ka, scanned_products.icu_ka),
                curve_type = COALESCE(EXCLUDED.curve_type, scanned_products.curve_type),
                manufacturer = COALESCE(EXCLUDED.manufacturer, scanned_products.manufacturer),
                scan_count = scanned_products.scan_count + 1,
                last_scanned_at = NOW()
            `, [site, normalizedRef, parsedDevice.manufacturer, parsedDevice.in_amps, parsedDevice.icu_ka, parsedDevice.ics_ka, parsedDevice.poles, parsedDevice.voltage_v, parsedDevice.curve_type]);
          } catch (e) {
            console.warn('[BULK CREATE] Cache error:', e.message);
          }
        }

      } catch (e) {
        console.error(`[BULK CREATE] Error processing device ${i}:`, e.message);
        errors.push({ index: i, device: device.position_label || device.name, error: e.message });
      }
    }

    // Mettre à jour les compteurs du tableau
    await quickQuery(`
      UPDATE switchboards SET
        device_count = (SELECT COUNT(*) FROM devices WHERE switchboard_id = $1),
        complete_count = (SELECT COUNT(*) FROM devices WHERE switchboard_id = $1 AND is_complete = true),
        updated_at = NOW()
      WHERE id = $1
    `, [switchboard_id]);

    // Audit log
    await quickQuery(`
      INSERT INTO switchboard_audit_log (site, action, entity_type, entity_id, actor_name, actor_email, details)
      VALUES ($1, 'bulk_created', 'devices', $2, $3, $4, $5)
    `, [site, switchboard_id, user.name, user.email, JSON.stringify({
      created: createdDevices.length,
      updated: updatedDevices.length,
      errors: errors.length,
      source: 'panel_scan'
    })]);

    console.log(`[BULK CREATE] Created ${createdDevices.length}, updated ${updatedDevices.length}, errors ${errors.length}`);

    res.json({
      success: true,
      created: createdDevices.length,
      updated: updatedDevices.length,
      errors: errors.length > 0 ? errors : undefined,
      devices: [...createdDevices, ...updatedDevices]
    });

  } catch (e) {
    console.error('[BULK CREATE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// AI DEVICE SEARCH
// ============================================================

app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const { query: searchQuery } = req.body;
    if (!searchQuery) return res.status(400).json({ error: 'Missing query' });
    if (!openai) return res.status(503).json({ error: 'OpenAI not available' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `Extrait les spécifications d'un disjoncteur. Retourne uniquement du JSON: {"manufacturer":"...", "reference":"...", "in_amps":number, "icu_ka":number, "poles":number, "voltage_v":number, "is_differential":bool}` 
        },
        { role: 'user', content: `Spécifications: ${searchQuery}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (e) {
    console.error('[SEARCH DEVICE]', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============================================================
// SEARCH HELPERS
// ============================================================

app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const searchQuery = (req.query.query || '').trim().toLowerCase();

    const where = ['site = $1'];
    const vals = [site];
    if (searchQuery) {
      where.push(`(LOWER(name) ILIKE $2 OR LOWER(code) ILIKE $2)`);
      vals.push(`%${searchQuery}%`);
    }

    const { rows } = await quickQuery(
      `SELECT id, name, code, building_code, floor, room
       FROM switchboards WHERE ${where.join(' AND ')}
       ORDER BY code, name LIMIT 20`, vals
    );
    
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS]', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============================================================
// STATS
// ============================================================

app.get('/api/switchboard/stats', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Optimized: use cached counts from switchboards table
    const stats = await quickQuery(`
      SELECT 
        COUNT(*)::int as total_boards,
        COALESCE(SUM(device_count), 0)::int as total_devices,
        COALESCE(SUM(complete_count), 0)::int as complete_devices,
        (SELECT COUNT(*)::int FROM devices d 
         JOIN switchboards sb ON d.switchboard_id = sb.id 
         WHERE sb.site = $1 AND d.is_differential = true) as differential_devices
      FROM switchboards WHERE site = $1
    `, [site]);

    res.json(stats.rows[0]);
  } catch (e) {
    console.error('[STATS]', e.message);
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ============================================================
// CALENDAR
// ============================================================

app.get('/api/switchboard/calendar', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const { rows } = await quickQuery(`
      SELECT id, name, code, building_code, floor, 
             COALESCE(device_count, 0) as device_count,
             COALESCE(complete_count, 0) as complete_count
      FROM switchboards
      WHERE site = $1 
      ORDER BY building_code, floor, code
    `, [site]);
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[CALENDAR]', e.message);
    res.status(500).json({ error: 'Calendar failed' });
  }
});

// ============================================================
// GRAPH (Arborescence)
// ============================================================

app.get('/api/switchboard/boards/:id/graph', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const rootId = Number(req.params.id);
    if (!rootId || isNaN(rootId)) return res.status(400).json({ error: 'Invalid board ID' });

    // Limit recursion depth to prevent infinite loops
    const MAX_DEPTH = 5;
    
    const buildTree = async (switchboardId, depth = 0) => {
      if (depth > MAX_DEPTH) return { switchboard_id: switchboardId, devices: [], truncated: true };

      // 🔧 Exclure photos BYTEA[] et pv_tests BYTEA pour éviter latence
      const { rows: devs } = await quickQuery(
        `SELECT id, site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type,
                manufacturer, reference, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
                position_number, is_differential, is_complete, settings, is_main_incoming,
                diagram_data, created_at, updated_at,
                COALESCE(array_length(photos, 1), 0) AS photos_count,
                (pv_tests IS NOT NULL) AS has_pv_tests
         FROM devices WHERE switchboard_id=$1 ORDER BY position_number ASC NULLS LAST`,
        [switchboardId]
      );
      
      const byId = new Map(devs.map(d => [d.id, { ...d, children: [], downstream: null }]));
      const roots = [];
      
      for (const d of devs) {
        const node = byId.get(d.id);
        if (d.parent_id && byId.has(d.parent_id)) {
          byId.get(d.parent_id).children.push(node);
        } else {
          roots.push(node);
        }
      }
      
      // Build downstream trees
      for (const node of byId.values()) {
        if (node.downstream_switchboard_id) {
          node.downstream = await buildTree(node.downstream_switchboard_id, depth + 1);
        }
      }
      
      return { switchboard_id: switchboardId, devices: roots };
    };

    const graph = await buildTree(rootId);
    res.json(graph);
  } catch (e) {
    console.error('[GRAPH]', e.message);
    res.status(500).json({ error: 'Graph failed' });
  }
});

// ============================================================
// SCANNED PRODUCTS CACHE
// ============================================================

app.post('/api/switchboard/scanned-products', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
            curve_type, is_differential, differential_sensitivity_ma, differential_type,
            settings, photo_base64, source } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    // Normalize reference for consistent matching
    const normalizedReference = normalizeRef(reference);
    if (!normalizedReference) return res.status(400).json({ error: 'Invalid reference' });

    // Check if exists (using normalized reference)
    const existing = await quickQuery(`
      SELECT id, scan_count FROM scanned_products
      WHERE site = $1 AND reference = $2
    `, [site, normalizedReference]);

    let result;
    if (existing.rows.length > 0) {
      result = await quickQuery(`
        UPDATE scanned_products SET
          device_type = COALESCE($1, device_type), in_amps = COALESCE($2, in_amps), icu_ka = COALESCE($3, icu_ka),
          ics_ka = COALESCE($4, ics_ka), poles = COALESCE($5, poles), voltage_v = COALESCE($6, voltage_v),
          trip_unit = COALESCE($7, trip_unit), is_differential = COALESCE($8, is_differential),
          settings = COALESCE($9, settings), photo_thumbnail = COALESCE($10, photo_thumbnail),
          curve_type = COALESCE($11, curve_type), differential_sensitivity_ma = COALESCE($12, differential_sensitivity_ma),
          differential_type = COALESCE($13, differential_type),
          scan_count = scan_count + 1, validated = true, last_scanned_at = NOW()
        WHERE id = $14 RETURNING *
      `, [device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential,
          settings ? JSON.stringify(settings) : null, photo_base64 ? Buffer.from(photo_base64, 'base64') : null,
          curve_type || null, differential_sensitivity_ma ? Number(differential_sensitivity_ma) : null,
          differential_type || null, existing.rows[0].id]);
    } else {
      result = await quickQuery(`
        INSERT INTO scanned_products (site, reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
          curve_type, is_differential, differential_sensitivity_ma, differential_type, settings, photo_thumbnail, validated, source, last_scanned_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17, NOW()) RETURNING *
      `, [site, normalizedReference, manufacturer, device_type || 'Low Voltage Circuit Breaker', in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
          curve_type || null, is_differential || false, differential_sensitivity_ma ? Number(differential_sensitivity_ma) : null,
          differential_type || null, settings ? JSON.stringify(settings) : '{}',
          photo_base64 ? Buffer.from(photo_base64, 'base64') : null, source || 'manual_entry']);
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (e) {
    console.error('[SCANNED PRODUCTS] save:', e.message);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

app.get('/api/switchboard/scanned-products/search', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { q, manufacturer, reference } = req.query;
    let sql = `SELECT id, reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
               curve_type, is_differential, differential_sensitivity_ma, differential_type,
               settings, scan_count, validated, last_scanned_at FROM scanned_products WHERE site = $1`;
    const params = [site];
    let idx = 2;
    
    if (q) { sql += ` AND (reference ILIKE $${idx} OR manufacturer ILIKE $${idx})`; params.push(`%${q}%`); idx++; }
    if (manufacturer) { sql += ` AND manufacturer ILIKE $${idx}`; params.push(`%${manufacturer}%`); idx++; }
    if (reference) { sql += ` AND reference ILIKE $${idx}`; params.push(`%${reference}%`); idx++; }
    
    sql += ` ORDER BY validated DESC, scan_count DESC, last_scanned_at DESC LIMIT 20`;
    
    const { rows } = await quickQuery(sql, params);
    res.json({ data: rows });
  } catch (e) {
    console.error('[SCANNED PRODUCTS] search:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/switchboard/scanned-products', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const { rows } = await quickQuery(`
      SELECT id, reference, manufacturer, device_type, in_amps, icu_ka, poles, voltage_v, is_differential, scan_count, validated
      FROM scanned_products WHERE site = $1 ORDER BY scan_count DESC, last_scanned_at DESC LIMIT 100
    `, [site]);
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[SCANNED PRODUCTS] list:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

app.delete('/api/switchboard/scanned-products/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid product ID' });
    
    await quickQuery('DELETE FROM scanned_products WHERE id = $1 AND site = $2', [id, site]);
    res.json({ success: true });
  } catch (e) {
    console.error('[SCANNED PRODUCTS] delete:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ============================================================
// PDF EXPORT - Professional Design v2
// ============================================================

// Electrical calculation helpers for PDF
const PDF_CABLE_PARAMS = { copper: { resistivity: 0.0178, tempCoeff: 0.00393 }, aluminum: { resistivity: 0.0287, tempCoeff: 0.00403 } };
const PDF_CABLE_SECTIONS = { 16: 1.5, 20: 2.5, 25: 4, 32: 6, 40: 10, 50: 16, 63: 25, 80: 35, 100: 50, 125: 70, 160: 95, 200: 120, 250: 150, 315: 185, 400: 240 };

function pdfGetCableSection(amps) {
  for (const [rating, section] of Object.entries(PDF_CABLE_SECTIONS)) { if (amps <= Number(rating)) return section; }
  return 240;
}

function pdfCalculateFaultLevel(voltage_v, source_fault_ka, cable_length_m, cable_section_mm2) {
  const c = 1.0, Un = voltage_v;
  const Zs = (c * Un) / (Math.sqrt(3) * source_fault_ka * 1000);
  const rhoT = PDF_CABLE_PARAMS.copper.resistivity * (1 + PDF_CABLE_PARAMS.copper.tempCoeff * 50);
  const Rc = (rhoT * cable_length_m * 2) / cable_section_mm2;
  const Xc = 0.08 * cable_length_m / 1000;
  const Rtotal = Zs * 0.3 + Rc, Xtotal = Zs * 0.95 + Xc;
  const Ztotal = Math.sqrt(Rtotal * Rtotal + Xtotal * Xtotal);
  const Ik_3ph = (c * Un) / (Math.sqrt(3) * Ztotal);
  const RX_ratio = Xtotal > 0 ? Rtotal / Xtotal : 0;
  const kappa = 1.02 + 0.98 * Math.exp(-3 * RX_ratio);
  const Ip = kappa * Math.sqrt(2) * Ik_3ph;
  const mu = 0.84 + 0.26 * Math.exp(-0.26 * RX_ratio);
  const Ib = mu * Ik_3ph;
  const Ith = Ik_3ph * Math.sqrt(0.99);
  return { Ik_kA: Ik_3ph / 1000, Ip_kA: Ip / 1000, Ib_kA: Ib / 1000, Ith_kA: Ith / 1000, RX_ratio, kappa, Ztotal_mohm: Ztotal * 1000 };
}

function pdfCalculateArcFlash(bolted_fault_ka, arc_duration_s, working_distance_mm) {
  const coef = { k1: -0.04287, k2: 1.035, k3: -0.083, k5: 0.0016, k6: 1.035, k7: -0.0631 };
  const lgIarc = coef.k1 + coef.k2 * Math.log10(bolted_fault_ka) + coef.k3 * Math.log10(32);
  const Iarc = Math.pow(10, lgIarc);
  const lgE = coef.k5 + coef.k6 * Math.log10(Iarc) + coef.k7 * Math.log10(working_distance_mm);
  const E = Math.pow(10, lgE) * (arc_duration_s / 0.2);
  const E_cal = E / 4.184;
  const AFB = working_distance_mm * Math.pow(Math.max(E / 1.2, 0.01), 0.5);
  // PPE minimum Cat. 1 pour tout travail sous tension (bonne pratique de sécurité IEC 61482 / NFPA 70E)
  const cats = [{ l: 1, m: 1.2, n: 'PPE Cat. 1 (énergie faible)' }, { l: 1, m: 4, n: 'PPE Cat. 1' }, { l: 2, m: 8, n: 'PPE Cat. 2' }, { l: 3, m: 25, n: 'PPE Cat. 3' }, { l: 4, m: 40, n: 'PPE Cat. 4' }, { l: 5, m: 9999, n: 'DANGER' }];
  const ppe = cats.find(p => E_cal <= p.m) || cats[5];
  return { incident_energy_cal: E_cal, arc_current_ka: Iarc, arc_flash_boundary_mm: AFB, ppe_category: ppe.l, ppe_name: ppe.n, arc_duration_ms: arc_duration_s * 1000 };
}

app.get('/api/switchboard/boards/:id/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    // 🔧 Exclure photo BYTEA pour éviter latence
    const boardRes = await quickQuery(
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal,
              modes, quality, diagram_data, device_count, complete_count, created_at, updated_at,
              (photo IS NOT NULL) AS has_photo
       FROM switchboards WHERE id = $1 AND site = $2`, [id, site]);
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });
    const board = boardRes.rows[0];

    // 🔧 Exclure photos BYTEA[] et pv_tests BYTEA pour éviter latence
    const devicesRes = await quickQuery(
      `SELECT d.id, d.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id, d.name,
              d.device_type, d.manufacturer, d.reference, d.in_amps, d.icu_ka, d.ics_ka, d.poles,
              d.voltage_v, d.trip_unit, d.position_number, d.is_differential, d.is_complete,
              d.settings, d.is_main_incoming, d.diagram_data, d.created_at, d.updated_at,
              COALESCE(array_length(d.photos, 1), 0) AS photos_count,
              (d.pv_tests IS NOT NULL) AS has_pv_tests,
              sb_down.name as downstream_name, sb_down.code as downstream_code
       FROM devices d
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.switchboard_id = $1
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`, [id]
    );
    const devices = devicesRes.rows;

    const upstreamRes = await quickQuery(
      `SELECT d.id, d.name, d.reference, d.manufacturer, d.in_amps, d.icu_ka,
              d.position_number,
              sb.name as source_board_name, sb.code as source_board_code
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.downstream_switchboard_id = $1`, [id]
    );
    const upstreamDevices = upstreamRes.rows;

    const logoRes = await quickQuery(`SELECT logo, logo_mime, company_name FROM site_settings WHERE site = $1`, [site]);
    const settings = logoRes.rows[0] || {};

    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(board.code || board.name).replace(/[^a-zA-Z0-9-_]/g, '_')}_listing.pdf"`);
    doc.pipe(res);

    // ═══════════════════════════════════════════════════════════════════
    // COLORS - Green theme as requested
    // ═══════════════════════════════════════════════════════════════════
    const colors = {
      primary: '#30EA03',      // Main green
      primaryDark: '#22c55e',  // Darker green for accent
      blue: '#3b82f6',
      blueDark: '#1e40af',
      blueBg: '#eff6ff',
      secondary: '#0f766e',
      success: '#10b981',
      successBg: '#ecfdf5',
      warning: '#f59e0b',
      warningBg: '#fef3c7',
      warningText: '#92400e',
      danger: '#dc2626',
      dangerBg: '#fee2e2',
      orange: '#f97316',
      orangeBg: '#fff7ed',
      purple: '#7c3aed',
      gray: '#6b7280',
      grayLight: '#f3f4f6',
      grayBorder: '#e5e7eb',
      text: '#111827',
      textMuted: '#6b7280',
    };

    // ═══════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    const safeNum = (v, d = 2) => { const n = Number(v); return isNaN(n) ? '-' : n.toFixed(d); };

    const drawRoundedRect = (x, y, w, h, r, fillColor, strokeColor = null) => {
      doc.save();
      doc.roundedRect(x, y, w, h, r);
      if (fillColor) doc.fillColor(fillColor).fill();
      doc.restore();
      if (strokeColor) { doc.save(); doc.roundedRect(x, y, w, h, r).strokeColor(strokeColor).stroke(); doc.restore(); }
    };

    const drawStatCard = (x, y, w, h, value, label, color) => {
      drawRoundedRect(x, y, w, h, 6, '#ffffff', colors.grayBorder);
      doc.rect(x, y + 4, 3, h - 8).fillColor(color).fill();
      doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted).text(label, x + 12, y + 6, { width: w - 20 });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(value, x + 12, y + 18, { width: w - 20 });
    };

    const drawMetricBox = (x, y, w, h, label, value, unit, highlight = false) => {
      drawRoundedRect(x, y, w, h, 4, colors.grayLight);
      doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted).text(label, x + 8, y + 5, { width: w - 16 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(highlight ? colors.success : colors.text);
      doc.text(value, x + 8, y + 17, { width: w - 35 });
      // Unit positioned at fixed right side of box
      if (unit) {
        doc.font('Helvetica').fontSize(9).fillColor(colors.textMuted);
        doc.text(unit, x + w - 35, y + 19, { width: 30, align: 'left' });
      }
    };

    // ═══════════════════════════════════════════════════════════════════
    // HEADER - Green theme #30EA03
    // ═══════════════════════════════════════════════════════════════════
    doc.rect(0, 0, 595, 75).fillColor(colors.primary).fill();
    doc.rect(0, 68, 595, 7).fillColor(colors.primaryDark).fill();

    // Logo with proper spacing
    let textStartX = 50;
    if (settings.logo) {
      try {
        doc.image(settings.logo, 45, 10, { fit: [55, 55], align: 'center', valign: 'center' });
        textStartX = 115;
      } catch (e) {}
    }

    // Title
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff');
    doc.text(board.name, textStartX, 12, { width: 300 });

    // Code
    doc.font('Helvetica-Bold').fontSize(11).fillColor('rgba(255,255,255,0.9)');
    doc.text(board.code || '', textStartX, 38);

    // Location
    const location = [board.building_code, board.floor ? `Etage ${board.floor}` : null, board.room].filter(Boolean).join(' - ');
    if (location) doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.8)').text(location, textStartX, 52);

    // Right side
    doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.95)');
    doc.text(new Date().toLocaleDateString('fr-FR'), 420, 12, { width: 135, align: 'right' });
    if (settings.company_name) doc.font('Helvetica-Bold').fontSize(10).text(settings.company_name, 420, 27, { width: 135, align: 'right' });

    // TGBT badge
    if (board.is_principal) {
      drawRoundedRect(495, 48, 55, 18, 4, '#ffffff');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.primary).text('TGBT', 495, 52, { width: 55, align: 'center' });
    }

    let currentY = 85;

    // ═══════════════════════════════════════════════════════════════════
    // UPSTREAM SOURCE BANNER (no emoji)
    // ═══════════════════════════════════════════════════════════════════
    if (upstreamDevices.length > 0) {
      const upText = upstreamDevices.map(d => {
        // Build breaker description: name + amps + position_number at the end
        const breakerName = d.name || d.reference || d.manufacturer || 'Depart';
        const breakerAmps = d.in_amps ? `${d.in_amps}A` : '';
        const breakerCode = d.position_number ? `groupe ${d.position_number}` : '';
        const breakerDesc = [breakerName, breakerAmps, breakerCode].filter(Boolean).join(' ');
        return `${d.source_board_code} via ${breakerDesc}`;
      }).join(', ');
      drawRoundedRect(40, currentY, 515, 20, 5, colors.warningBg, colors.warning);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.warning).text('ALIMENTE PAR', 52, currentY + 5);
      doc.font('Helvetica').fontSize(8).fillColor(colors.warningText).text(upText, 130, currentY + 5, { width: 415 });
      currentY += 28;
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATISTICS CARDS
    // ═══════════════════════════════════════════════════════════════════
    const totalDevices = devices.length;
    const completeDevices = devices.filter(d => d.is_complete).length;
    const differentialDevices = devices.filter(d => d.is_differential).length;
    const mainIncoming = devices.find(d => d.is_main_incoming);
    const downstreamCount = devices.filter(d => d.downstream_switchboard_id).length;
    const completionPct = totalDevices > 0 ? Math.round((completeDevices / totalDevices) * 100) : 0;

    const cardW = 122, cardH = 38, cardGap = 8;
    drawStatCard(40, currentY, cardW, cardH, String(totalDevices), 'Equipements', colors.blueDark);
    drawStatCard(40 + cardW + cardGap, currentY, cardW, cardH, `${completionPct}%`, 'Completion', completionPct === 100 ? colors.success : colors.warning);
    drawStatCard(40 + (cardW + cardGap) * 2, currentY, cardW, cardH, String(differentialDevices), 'DDR', colors.purple);
    drawStatCard(40 + (cardW + cardGap) * 3, currentY, cardW, cardH, String(downstreamCount), 'Departs', colors.secondary);
    currentY += cardH + 10;

    // ═══════════════════════════════════════════════════════════════════
    // FAULT LEVEL ASSESSMENT (like screenshot)
    // ═══════════════════════════════════════════════════════════════════
    const mainDev = mainIncoming || upstreamDevices[0] || {};
    if (mainDev.in_amps || upstreamDevices.length > 0) {
      const cableSection = pdfGetCableSection(mainDev.in_amps || 100);
      const fla = pdfCalculateFaultLevel(400, 50, 20, cableSection);
      const icuOk = !mainDev.icu_ka || fla.Ik_kA <= mainDev.icu_ka;

      // Card container
      drawRoundedRect(40, currentY, 515, 105, 8, '#ffffff', colors.grayBorder);

      // Header bar
      doc.rect(40, currentY, 515, 26).fillColor(icuOk ? colors.blueBg : colors.dangerBg).fill();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(icuOk ? colors.blueDark : colors.danger);
      doc.text('Fault Level Assessment', 55, currentY + 8);

      // OK/DANGER badge
      drawRoundedRect(485, currentY + 4, 60, 18, 9, icuOk ? colors.success : colors.danger);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(icuOk ? 'OK' : 'DANGER', 485, currentY + 9, { width: 60, align: 'center' });

      // Metrics row 1
      const mY = currentY + 32, mW = 118, mH = 30, mG = 6;
      drawMetricBox(50, mY, mW, mH, 'Ik" (Initial)', safeNum(fla.Ik_kA), 'kA', true);
      drawMetricBox(50 + mW + mG, mY, mW, mH, 'Ip (Crete)', safeNum(fla.Ip_kA), 'kA');
      drawMetricBox(50 + (mW + mG) * 2, mY, mW, mH, 'Ib (Coupure)', safeNum(fla.Ib_kA), 'kA');
      drawMetricBox(50 + (mW + mG) * 3, mY, mW, mH, 'Ith (1s)', safeNum(fla.Ith_kA), 'kA');

      // Metrics row 2
      const m2Y = mY + mH + 5, m2W = 158;
      drawMetricBox(50, m2Y, m2W, mH, 'R/X', safeNum(fla.RX_ratio, 3), '');
      drawMetricBox(50 + m2W + mG, m2Y, m2W, mH, 'Kappa', safeNum(fla.kappa, 3), '');
      drawMetricBox(50 + (m2W + mG) * 2, m2Y, m2W, mH, 'Z total', safeNum(fla.Ztotal_mohm), 'mohm');

      // Footer
      doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted);
      doc.text(`Icu disjoncteur: ${mainDev.icu_ka || '-'} kA`, 50, currentY + 95);
      doc.text('Calcule selon IEC 60909-0', 250, currentY + 95);

      currentY += 115;

      // ═══════════════════════════════════════════════════════════════════
      // ARC FLASH ANALYSIS (like screenshot)
      // ═══════════════════════════════════════════════════════════════════
      const tripTime = (mainDev.in_amps || 100) > 63 ? 0.05 : 0.02;
      const af = pdfCalculateArcFlash(fla.Ik_kA, tripTime, 455);
      // Couleurs PPE: Cat. 1 = bleu, Cat. 2 = jaune/warning, Cat. 3+ = rouge/danger
      const ppeColor = af.ppe_category <= 1 ? colors.blue : af.ppe_category <= 2 ? colors.warning : colors.danger;

      drawRoundedRect(40, currentY, 515, 95, 8, '#ffffff', colors.grayBorder);

      // Header bar orange
      doc.rect(40, currentY, 515, 26).fillColor(colors.orangeBg).fill();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(colors.orange);
      doc.text('Arc Flash Analysis', 55, currentY + 8);

      // PPE badge
      drawRoundedRect(440, currentY + 4, 105, 18, 9, ppeColor);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text(af.ppe_name, 440, currentY + 9, { width: 105, align: 'center' });

      // Metrics
      const afY = currentY + 32;
      drawMetricBox(50, afY, mW, mH, 'Energie incidente', safeNum(af.incident_energy_cal), 'cal/cm2');
      drawMetricBox(50 + mW + mG, afY, mW, mH, 'Arc Flash Boundary', safeNum(af.arc_flash_boundary_mm, 0), 'mm');
      drawMetricBox(50 + (mW + mG) * 2, afY, mW, mH, 'Courant d\'arc', safeNum(af.arc_current_ka), 'kA');
      drawMetricBox(50 + (mW + mG) * 3, afY, mW, mH, 'Duree arc', safeNum(af.arc_duration_ms, 0), 'ms');

      // Warning banner
      if (af.ppe_category > 0) {
        drawRoundedRect(50, afY + mH + 5, 495, 18, 4, colors.warningBg, colors.warning);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.warning).text('WARNING', 60, afY + mH + 10);
        doc.font('Helvetica').text('Arc Flash Hazard', 115, afY + mH + 10);
      }

      doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted);
      doc.text('Calcule selon IEEE 1584-2018 | Distance: 455mm', 50, currentY + 85);

      currentY += 105;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN BREAKER INFO
    // ═══════════════════════════════════════════════════════════════════
    if (mainIncoming) {
      drawRoundedRect(40, currentY, 515, 22, 5, colors.successBg, colors.success);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.success).text('DISJONCTEUR D\'ARRIVEE', 52, currentY + 6);
      const mainInfo = [mainIncoming.manufacturer, mainIncoming.reference, mainIncoming.in_amps ? `${mainIncoming.in_amps}A` : null, mainIncoming.icu_ka ? `${mainIncoming.icu_ka}kA` : null].filter(Boolean).join(' - ');
      doc.font('Helvetica').fontSize(9).fillColor('#065f46').text(mainInfo, 185, currentY + 6, { width: 360 });
      currentY += 28;
    }

    // ═══════════════════════════════════════════════════════════════════
    // DEVICES TABLE
    // ═══════════════════════════════════════════════════════════════════
    currentY += 5;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text).text('Liste des equipements', 40, currentY);
    currentY += 16;

    const colWidths = [30, 150, 90, 68, 40, 40, 30, 62];
    const headers = ['N', 'Designation', 'Reference', 'Fabricant', 'In', 'Icu', 'P', 'Type'];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const tableX = 40;

    const drawTableHeader = (y) => {
      drawRoundedRect(tableX, y, totalWidth, 20, 4, colors.primary);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      let x = tableX;
      headers.forEach((h, i) => { doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8 }); x += colWidths[i]; });
      return y + 20;
    };

    const measureRowHeight = (device) => {
      doc.font('Helvetica').fontSize(8);
      const nameH = doc.heightOfString(device.name || '-', { width: colWidths[1] - 10 });
      return Math.max(20, nameH + 8);
    };

    const getTypeInfo = (d) => {
      if (d.downstream_code) return { text: '> ' + d.downstream_code, color: colors.success, bg: '#d1fae5' };
      if (d.is_main_incoming) return { text: 'Arrivee', color: colors.warning, bg: colors.warningBg };
      if (d.is_differential) return { text: 'DDR', color: colors.purple, bg: '#ede9fe' };
      if (!d.is_complete) return { text: 'Incomplet', color: colors.danger, bg: colors.dangerBg };
      return { text: '-', color: colors.gray, bg: null };
    };

    currentY = drawTableHeader(currentY);

    devices.forEach((d, idx) => {
      const rowH = measureRowHeight(d);
      if (currentY + rowH > 780) { doc.addPage(); currentY = 40; currentY = drawTableHeader(currentY); }

      if (idx % 2 === 0) doc.rect(tableX, currentY, totalWidth, rowH).fillColor(colors.grayLight).fill();
      doc.rect(tableX, currentY, totalWidth, rowH).strokeColor(colors.grayBorder).stroke();

      let x = tableX;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.primary);
      doc.text(d.position_number || String(idx + 1), x + 4, currentY + 5, { width: colWidths[0] - 8 });
      x += colWidths[0];

      doc.font('Helvetica').fillColor(colors.text);
      doc.text(d.name || '-', x + 4, currentY + 5, { width: colWidths[1] - 8 });
      x += colWidths[1];

      doc.fillColor(colors.textMuted);
      doc.text(d.reference || '-', x + 4, currentY + 5, { width: colWidths[2] - 8, lineBreak: false, ellipsis: true });
      x += colWidths[2];

      doc.text(d.manufacturer || '-', x + 4, currentY + 5, { width: colWidths[3] - 8, lineBreak: false, ellipsis: true });
      x += colWidths[3];

      doc.font('Helvetica-Bold').fillColor(colors.text);
      doc.text(d.in_amps ? `${d.in_amps}A` : '-', x + 4, currentY + 5, { width: colWidths[4] - 8 });
      x += colWidths[4];

      doc.font('Helvetica').fillColor(colors.textMuted);
      doc.text(d.icu_ka ? `${d.icu_ka}kA` : '-', x + 4, currentY + 5, { width: colWidths[5] - 8 });
      x += colWidths[5];

      doc.text(d.poles ? `${d.poles}P` : '-', x + 4, currentY + 5, { width: colWidths[6] - 8 });
      x += colWidths[6];

      const ti = getTypeInfo(d);
      if (ti.bg) drawRoundedRect(x + 2, currentY + 3, colWidths[7] - 4, 14, 3, ti.bg);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ti.color);
      doc.text(ti.text, x + 4, currentY + 6, { width: colWidths[7] - 8, align: 'center', lineBreak: false, ellipsis: true });

      currentY += rowH;
    });

    // ═══════════════════════════════════════════════════════════════════
    // PAGE NUMBERS
    // ═══════════════════════════════════════════════════════════════════
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor(colors.gray);
      doc.text(`${board.code || board.name} - Page ${i + 1}/${range.count}`, 40, 815, { width: 515, align: 'center' });
    }

    doc.end();
  } catch (e) {
    console.error('[PDF EXPORT]', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' });
  }
});

// ============================================================
// SWITCHBOARD CONTROLS - API v1.0
// ============================================================

// --- TEMPLATES ---

// List templates
app.get('/api/switchboard/controls/templates', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { target_type } = req.query;
    let sql = `SELECT * FROM control_templates WHERE site = $1`;
    const params = [site];

    if (target_type) {
      sql += ` AND target_type = $2`;
      params.push(target_type);
    }
    sql += ` ORDER BY name`;

    const { rows } = await quickQuery(sql, params);
    res.json({ templates: rows });
  } catch (e) {
    console.error('[CONTROLS] List templates error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create template
app.post('/api/switchboard/controls/templates', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { name, description, target_type, frequency_months, checklist_items, element_filter } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const createdBy = req.headers['x-user-email'] || req.headers['x-user-name'] || 'unknown';

    const { rows } = await quickQuery(`
      INSERT INTO control_templates (site, name, description, target_type, frequency_months, checklist_items, created_by, element_filter)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [site, name, description || null, target_type || 'switchboard', frequency_months || 12,
        JSON.stringify(checklist_items || []), createdBy, element_filter || null]);

    res.json({ template: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Create template error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Update template
app.put('/api/switchboard/controls/templates/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    const { name, description, target_type, frequency_months, checklist_items, is_active, element_filter } = req.body;

    const { rows } = await quickQuery(`
      UPDATE control_templates
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          target_type = COALESCE($3, target_type),
          frequency_months = COALESCE($4, frequency_months),
          checklist_items = COALESCE($5, checklist_items),
          is_active = COALESCE($6, is_active),
          element_filter = $7,
          updated_at = NOW()
      WHERE id = $8 AND site = $9
      RETURNING *
    `, [name, description, target_type, frequency_months,
        checklist_items ? JSON.stringify(checklist_items) : null, is_active, element_filter !== undefined ? element_filter : null, id, site]);

    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Update template error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete template
app.delete('/api/switchboard/controls/templates/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    await quickQuery(`DELETE FROM control_templates WHERE id = $1 AND site = $2`, [id, site]);
    res.json({ success: true });
  } catch (e) {
    console.error('[CONTROLS] Delete template error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- SCHEDULES ---

// List schedules (with filters) - EXTENDED for VSD, MECA, Mobile Equipment, HV, Datahub
app.get('/api/switchboard/controls/schedules', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type, status, overdue } = req.query;

    let sql = `
      SELECT cs.*,
             ct.name as template_name, ct.target_type, ct.frequency_months,
             sb.name as switchboard_name, sb.code as switchboard_code,
             d.name as device_name, d.position_number as device_position, d.switchboard_id as device_switchboard_id,
             dsb.code as device_switchboard_code,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             hv.name as hv_equipment_name, hv.code as hv_equipment_code, hv.building_code as hv_equipment_building, hv.regime_neutral as hv_regime_neutral,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building,
             dh.name as datahub_equipment_name, dh.code as datahub_equipment_code, dh.building as datahub_equipment_building,
             dhc.name as datahub_category_name, dhc.color as datahub_category_color, dhc.icon as datahub_category_icon
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards sb ON cs.switchboard_id = sb.id
      LEFT JOIN devices d ON cs.device_id = d.id
      LEFT JOIN switchboards dsb ON d.switchboard_id = dsb.id
      LEFT JOIN vsd_equipments vsd ON cs.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cs.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cs.mobile_equipment_id::text = me.id::text
      LEFT JOIN hv_equipments hv ON cs.hv_equipment_id::text = hv.id::text
      LEFT JOIN glo_equipments glo ON cs.glo_equipment_id::text = glo.id::text
      LEFT JOIN dh_items dh ON cs.datahub_equipment_id::text = dh.id::text
      LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
      WHERE cs.site = $1
    `;
    const params = [site];
    let idx = 2;

    if (switchboard_id) {
      sql += ` AND cs.switchboard_id = $${idx++}`;
      params.push(switchboard_id);
    }
    if (device_id) {
      sql += ` AND cs.device_id = $${idx++}`;
      params.push(device_id);
    }
    if (vsd_equipment_id) {
      sql += ` AND cs.vsd_equipment_id::text = $${idx++}`;
      params.push(String(vsd_equipment_id));
    }
    if (meca_equipment_id) {
      sql += ` AND cs.meca_equipment_id::text = $${idx++}`;
      params.push(String(meca_equipment_id));
    }
    if (mobile_equipment_id) {
      sql += ` AND cs.mobile_equipment_id::text = $${idx++}`;
      params.push(String(mobile_equipment_id));
    }
    if (hv_equipment_id) {
      sql += ` AND cs.hv_equipment_id::text = $${idx++}`;
      params.push(String(hv_equipment_id));
    }
    if (glo_equipment_id) {
      sql += ` AND cs.glo_equipment_id::text = $${idx++}`;
      params.push(String(glo_equipment_id));
    }
    if (datahub_equipment_id) {
      sql += ` AND cs.datahub_equipment_id::text = $${idx++}`;
      params.push(String(datahub_equipment_id));
    }
    if (equipment_type) {
      sql += ` AND cs.equipment_type = $${idx++}`;
      params.push(equipment_type);
    }
    if (status) {
      sql += ` AND cs.status = $${idx++}`;
      params.push(status);
    }
    if (overdue === 'true') {
      sql += ` AND cs.next_due_date < CURRENT_DATE`;
    }

    sql += ` ORDER BY cs.next_due_date ASC NULLS LAST`;

    const { rows } = await quickQuery(sql, params);

    // Update overdue status
    const now = new Date();
    rows.forEach(r => {
      if (r.next_due_date && new Date(r.next_due_date) < now && r.status !== 'done') {
        r.status = 'overdue';
      }
    });

    res.json({ schedules: rows });
  } catch (e) {
    console.error('[CONTROLS] List schedules error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create schedule (assign control to any equipment type) - EXTENDED with HV and Datahub
app.post('/api/switchboard/controls/schedules', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { template_id, switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type, next_due_date } = req.body;
    if (!template_id) return res.status(400).json({ error: 'Template ID required' });

    // Determine equipment type based on which ID is provided
    let detectedType = equipment_type || 'switchboard';
    if (datahub_equipment_id) detectedType = 'datahub';
    else if (glo_equipment_id) detectedType = 'glo';
    else if (hv_equipment_id) detectedType = 'hv';
    else if (vsd_equipment_id) detectedType = 'vsd';
    else if (meca_equipment_id) detectedType = 'meca';
    else if (mobile_equipment_id) detectedType = 'mobile_equipment';
    else if (device_id) detectedType = 'device';
    else if (switchboard_id) detectedType = 'switchboard';

    if (!switchboard_id && !device_id && !vsd_equipment_id && !meca_equipment_id && !mobile_equipment_id && !hv_equipment_id && !glo_equipment_id && !datahub_equipment_id) {
      return res.status(400).json({ error: 'Equipment ID required (switchboard, device, vsd, meca, mobile_equipment, hv, glo, or datahub)' });
    }

    // Check if schedule already exists for this template and equipment
    let existingCheck = `SELECT id FROM control_schedules WHERE site = $1 AND template_id = $2 AND (`;
    const existingParams = [site, template_id];
    const conditions = [];
    let pIdx = 3;

    if (switchboard_id) { conditions.push(`switchboard_id = $${pIdx++}`); existingParams.push(switchboard_id); }
    if (device_id) { conditions.push(`device_id = $${pIdx++}`); existingParams.push(device_id); }
    if (vsd_equipment_id) { conditions.push(`vsd_equipment_id::text = $${pIdx++}`); existingParams.push(String(vsd_equipment_id)); }
    if (meca_equipment_id) { conditions.push(`meca_equipment_id::text = $${pIdx++}`); existingParams.push(String(meca_equipment_id)); }
    if (mobile_equipment_id) { conditions.push(`mobile_equipment_id::text = $${pIdx++}`); existingParams.push(String(mobile_equipment_id)); }
    if (hv_equipment_id) { conditions.push(`hv_equipment_id::text = $${pIdx++}`); existingParams.push(String(hv_equipment_id)); }
    if (glo_equipment_id) { conditions.push(`glo_equipment_id::text = $${pIdx++}`); existingParams.push(String(glo_equipment_id)); }
    if (datahub_equipment_id) { conditions.push(`datahub_equipment_id::text = $${pIdx++}`); existingParams.push(String(datahub_equipment_id)); }

    existingCheck += conditions.join(' OR ') + ')';

    const existing = await quickQuery(existingCheck, existingParams);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Schedule already exists for this template and equipment' });
    }

    const { rows } = await quickQuery(`
      INSERT INTO control_schedules (site, template_id, switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type, next_due_date, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
      RETURNING *
    `, [site, template_id, switchboard_id || null, device_id || null, vsd_equipment_id || null, meca_equipment_id || null, mobile_equipment_id || null, hv_equipment_id || null, glo_equipment_id || null, datahub_equipment_id || null, detectedType, next_due_date || new Date()]);

    res.json({ schedule: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Create schedule error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete schedule
app.delete('/api/switchboard/controls/schedules/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    await quickQuery(`DELETE FROM control_schedules WHERE id = $1 AND site = $2`, [id, site]);
    res.json({ success: true });
  } catch (e) {
    console.error('[CONTROLS] Delete schedule error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- CONTROL RECORDS ---

// List control history - EXTENDED with HV
app.get('/api/switchboard/controls/records', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type, limit = 50 } = req.query;

    let sql = `
      SELECT cr.*,
             ct.name as template_name,
             sb.name as switchboard_name, sb.code as switchboard_code,
             d.name as device_name, d.position_number as device_position, d.switchboard_id as device_switchboard_id,
             dsb.code as device_switchboard_code,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             hv.name as hv_equipment_name, hv.code as hv_equipment_code, hv.building_code as hv_equipment_building, hv.regime_neutral as hv_regime_neutral,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building,
             dh.name as datahub_equipment_name, dh.code as datahub_equipment_code, dh.building as datahub_equipment_building,
             dhc.name as datahub_category_name, dhc.color as datahub_category_color, dhc.icon as datahub_category_icon
      FROM control_records cr
      LEFT JOIN control_templates ct ON cr.template_id = ct.id
      LEFT JOIN switchboards sb ON cr.switchboard_id = sb.id
      LEFT JOIN devices d ON cr.device_id = d.id
      LEFT JOIN switchboards dsb ON d.switchboard_id = dsb.id
      LEFT JOIN vsd_equipments vsd ON cr.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cr.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cr.mobile_equipment_id::text = me.id::text
      LEFT JOIN hv_equipments hv ON cr.hv_equipment_id::text = hv.id::text
      LEFT JOIN glo_equipments glo ON cr.glo_equipment_id::text = glo.id::text
      LEFT JOIN dh_items dh ON cr.datahub_equipment_id::text = dh.id::text
      LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
      WHERE cr.site = $1
    `;
    const params = [site];
    let idx = 2;

    if (switchboard_id) {
      sql += ` AND cr.switchboard_id = $${idx++}`;
      params.push(switchboard_id);
    }
    if (device_id) {
      sql += ` AND cr.device_id = $${idx++}`;
      params.push(device_id);
    }
    if (vsd_equipment_id) {
      sql += ` AND cr.vsd_equipment_id::text = $${idx++}`;
      params.push(String(vsd_equipment_id));
    }
    if (meca_equipment_id) {
      sql += ` AND cr.meca_equipment_id::text = $${idx++}`;
      params.push(String(meca_equipment_id));
    }
    if (hv_equipment_id) {
      sql += ` AND cr.hv_equipment_id::text = $${idx++}`;
      params.push(String(hv_equipment_id));
    }
    if (mobile_equipment_id) {
      sql += ` AND cr.mobile_equipment_id::text = $${idx++}`;
      params.push(String(mobile_equipment_id));
    }
    if (glo_equipment_id) {
      sql += ` AND cr.glo_equipment_id::text = $${idx++}`;
      params.push(String(glo_equipment_id));
    }
    if (datahub_equipment_id) {
      sql += ` AND cr.datahub_equipment_id::text = $${idx++}`;
      params.push(String(datahub_equipment_id));
    }
    if (equipment_type) {
      sql += ` AND cr.equipment_type = $${idx++}`;
      params.push(equipment_type);
    }

    sql += ` ORDER BY cr.performed_at DESC LIMIT $${idx}`;
    params.push(Number(limit));

    const { rows } = await quickQuery(sql, params);
    res.json({ records: rows });
  } catch (e) {
    console.error('[CONTROLS] List records error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get single record with attachments
app.get('/api/switchboard/controls/records/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;

    const recordRes = await quickQuery(`
      SELECT cr.*,
             ct.name as template_name, ct.checklist_items as template_items,
             sb.name as switchboard_name, sb.code as switchboard_code,
             d.name as device_name, d.position_number as device_position,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building
      FROM control_records cr
      LEFT JOIN control_templates ct ON cr.template_id = ct.id
      LEFT JOIN switchboards sb ON cr.switchboard_id = sb.id
      LEFT JOIN devices d ON cr.device_id = d.id
      LEFT JOIN vsd_equipments vsd ON cr.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cr.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cr.mobile_equipment_id::text = me.id::text
      LEFT JOIN glo_equipments glo ON cr.glo_equipment_id::text = glo.id::text
      WHERE cr.id = $1 AND cr.site = $2
    `, [id, site]);

    if (!recordRes.rows.length) return res.status(404).json({ error: 'Record not found' });

    const attachments = await quickQuery(`
      SELECT id, checklist_item_id, file_type, file_name, file_mime, caption, created_at
      FROM control_attachments WHERE control_record_id = $1
    `, [id]);

    res.json({ record: recordRes.rows[0], attachments: attachments.rows });
  } catch (e) {
    console.error('[CONTROLS] Get record error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create control record (complete a control) - EXTENDED for all equipment types including HV and Datahub
app.post('/api/switchboard/controls/records', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { schedule_id, template_id, switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type,
            checklist_results, global_notes, signature_base64, status, draft_attachment_ids } = req.body;

    const performedBy = req.headers['x-user-name'] || 'unknown';
    const performedByEmail = req.headers['x-user-email'] || null;

    // Determine equipment type
    let detectedType = equipment_type || 'switchboard';
    if (datahub_equipment_id) detectedType = 'datahub';
    else if (glo_equipment_id) detectedType = 'glo';
    else if (hv_equipment_id) detectedType = 'hv';
    else if (vsd_equipment_id) detectedType = 'vsd';
    else if (meca_equipment_id) detectedType = 'meca';
    else if (mobile_equipment_id) detectedType = 'mobile_equipment';
    else if (device_id) detectedType = 'device';

    // Insert record
    const { rows } = await quickQuery(`
      INSERT INTO control_records
        (site, schedule_id, template_id, switchboard_id, device_id, vsd_equipment_id, meca_equipment_id, mobile_equipment_id, hv_equipment_id, glo_equipment_id, datahub_equipment_id, equipment_type,
         performed_by, performed_by_email, checklist_results, global_notes, signature_base64, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [site, schedule_id || null, template_id || null, switchboard_id || null, device_id || null,
        vsd_equipment_id || null, meca_equipment_id || null, mobile_equipment_id || null, hv_equipment_id || null, glo_equipment_id || null, datahub_equipment_id || null, detectedType,
        performedBy, performedByEmail, JSON.stringify(checklist_results || []),
        global_notes || null, signature_base64 || null, status || 'conform']);

    const record = rows[0];

    // Move draft attachments to final record (if any)
    if (draft_attachment_ids && draft_attachment_ids.length > 0) {
      for (const draftAttId of draft_attachment_ids) {
        try {
          // Copy from draft_attachments to control_attachments
          await quickQuery(`
            INSERT INTO control_attachments (site, control_record_id, file_type, file_name, file_mime, file_data, thumbnail, created_at)
            SELECT site, $1, file_type, file_name, file_mime, file_data, thumbnail, created_at
            FROM control_draft_attachments
            WHERE id = $2 AND site = $3
          `, [record.id, draftAttId, site]);
        } catch (attErr) {
          console.warn('[CONTROLS] Failed to move draft attachment:', draftAttId, attErr.message);
        }
      }
    }

    // Update schedule if provided
    if (schedule_id) {
      // Get template frequency
      const scheduleRes = await quickQuery(`
        SELECT cs.*, ct.frequency_months
        FROM control_schedules cs
        JOIN control_templates ct ON cs.template_id = ct.id
        WHERE cs.id = $1
      `, [schedule_id]);

      if (scheduleRes.rows.length > 0) {
        const freq = scheduleRes.rows[0].frequency_months || 12;
        const nextDate = new Date();
        nextDate.setMonth(nextDate.getMonth() + freq);

        await quickQuery(`
          UPDATE control_schedules
          SET last_control_date = CURRENT_DATE,
              last_control_id = $1,
              next_due_date = $2,
              status = 'pending',
              updated_at = NOW()
          WHERE id = $3
        `, [record.id, nextDate, schedule_id]);
      }
    }

    // 🔔 Push notification for completed control
    const isConform = status === 'conform' || status === 'ok' || status === 'conforme';

    // Build URL based on equipment type
    let controlUrl = '/app/switchboard-controls';
    if (switchboard_id) controlUrl = `/app/switchboards?board=${switchboard_id}`;
    else if (device_id) controlUrl = `/app/switchboards?device=${device_id}`;
    else if (vsd_equipment_id) controlUrl = `/app/vsd?vsd=${vsd_equipment_id}`;
    else if (meca_equipment_id) controlUrl = `/app/meca?meca=${meca_equipment_id}`;
    else if (mobile_equipment_id) controlUrl = `/app/mobile-equipments?equipment=${mobile_equipment_id}`;
    else if (hv_equipment_id) controlUrl = `/app/hv?equipment=${hv_equipment_id}`;
    else if (glo_equipment_id) controlUrl = `/app/glo?glo=${glo_equipment_id}`;
    else if (datahub_equipment_id) controlUrl = `/app/datahub?equipment=${datahub_equipment_id}`;

    notify(
      isConform ? '✅ Contrôle terminé' : '⚠️ Contrôle avec NC',
      `${detectedType.toUpperCase()} - ${isConform ? 'Conforme' : 'Non-conforme'}`,
      {
        type: 'control_completed',
        requireInteraction: !isConform,
        data: { recordId: record.id, status, url: controlUrl },
        excludeUserId: performedByEmail
      }
    ).catch(err => console.log('[SWITCHBOARD] Push notify error:', err.message));

    res.json({ record, message: 'Control completed successfully' });
  } catch (e) {
    console.error('[CONTROLS] Create record error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- ATTACHMENTS ---

// Upload attachment
app.post('/api/switchboard/controls/records/:recordId/attachments', upload.single('file'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { recordId } = req.params;
    const { checklist_item_id, caption, file_type } = req.body;

    // Generate thumbnail for images
    let thumbnail = null;
    if (req.file.mimetype.startsWith('image/')) {
      try {
        thumbnail = await sharp(req.file.buffer)
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();
      } catch (e) {
        console.warn('[CONTROLS] Thumbnail generation failed:', e.message);
      }
    }

    const { rows } = await quickQuery(`
      INSERT INTO control_attachments
        (site, control_record_id, checklist_item_id, file_type, file_name, file_mime, file_data, thumbnail, caption)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, checklist_item_id, file_type, file_name, file_mime, caption, created_at
    `, [site, recordId, checklist_item_id || null, file_type || 'photo',
        req.file.originalname, req.file.mimetype, req.file.buffer, thumbnail, caption || null]);

    res.json({ attachment: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Upload attachment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get attachment file
app.get('/api/switchboard/controls/attachments/:id/file', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    const { thumbnail } = req.query;

    const column = thumbnail === 'true' ? 'thumbnail' : 'file_data';
    const { rows } = await quickQuery(`
      SELECT ${column} as data, file_mime, file_name FROM control_attachments WHERE id = $1 AND site = $2
    `, [id, site]);

    if (!rows.length || !rows[0].data) return res.status(404).json({ error: 'Attachment not found' });

    res.set('Content-Type', rows[0].file_mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${rows[0].file_name}"`);
    res.send(rows[0].data);
  } catch (e) {
    console.error('[CONTROLS] Get attachment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- CONTROL DRAFTS (Brouillons) ---

// Get draft for a schedule
app.get('/api/switchboard/controls/drafts/:scheduleId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { scheduleId } = req.params;

    // Get draft data
    const { rows: drafts } = await quickQuery(`
      SELECT * FROM control_drafts WHERE schedule_id = $1 AND site = $2
    `, [scheduleId, site]);

    if (!drafts.length) {
      return res.json({ draft: null, attachments: [] });
    }

    // Get draft attachments
    const { rows: attachments } = await quickQuery(`
      SELECT id, file_type, file_name, file_mime, created_at
      FROM control_draft_attachments
      WHERE schedule_id = $1 AND site = $2
      ORDER BY created_at ASC
    `, [scheduleId, site]);

    res.json({ draft: drafts[0], attachments });
  } catch (e) {
    console.error('[CONTROLS] Get draft error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create or update draft (upsert)
app.put('/api/switchboard/controls/drafts/:scheduleId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { scheduleId } = req.params;
    const { checklist_results, global_notes, status } = req.body;

    const { rows } = await quickQuery(`
      INSERT INTO control_drafts (site, schedule_id, checklist_results, global_notes, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (site, schedule_id)
      DO UPDATE SET
        checklist_results = COALESCE($3, control_drafts.checklist_results),
        global_notes = COALESCE($4, control_drafts.global_notes),
        status = COALESCE($5, control_drafts.status),
        updated_at = NOW()
      RETURNING *
    `, [site, scheduleId, JSON.stringify(checklist_results || []), global_notes || '', status || 'conform']);

    res.json({ draft: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Save draft error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Upload attachment to draft
app.post('/api/switchboard/controls/drafts/:scheduleId/attachments', upload.single('file'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { scheduleId } = req.params;
    const file = req.file;
    const file_type = req.body.file_type || 'photo';

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Ensure draft exists
    const { rows: drafts } = await quickQuery(`
      INSERT INTO control_drafts (site, schedule_id, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (site, schedule_id) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, [site, scheduleId]);

    const draftId = drafts[0].id;

    // Generate thumbnail for images
    let thumbnail = null;
    if (file.mimetype.startsWith('image/')) {
      try {
        thumbnail = await sharp(file.buffer)
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();
      } catch (e) {
        console.warn('[CONTROLS] Thumbnail generation failed:', e.message);
      }
    }

    // Insert attachment
    const { rows } = await quickQuery(`
      INSERT INTO control_draft_attachments
        (site, draft_id, schedule_id, file_type, file_name, file_mime, file_data, thumbnail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, file_type, file_name, file_mime, created_at
    `, [site, draftId, scheduleId, file_type, file.originalname, file.mimetype, file.buffer, thumbnail]);

    res.json({ attachment: rows[0] });
  } catch (e) {
    console.error('[CONTROLS] Upload draft attachment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get draft attachment file
app.get('/api/switchboard/controls/drafts/attachments/:id/file', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;
    const { thumbnail } = req.query;

    const column = thumbnail === 'true' ? 'thumbnail' : 'file_data';
    const { rows } = await quickQuery(`
      SELECT ${column} as data, file_mime, file_name FROM control_draft_attachments WHERE id = $1 AND site = $2
    `, [id, site]);

    if (!rows.length || !rows[0].data) return res.status(404).json({ error: 'Attachment not found' });

    res.set('Content-Type', rows[0].file_mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${rows[0].file_name}"`);
    res.send(rows[0].data);
  } catch (e) {
    console.error('[CONTROLS] Get draft attachment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete single draft attachment
app.delete('/api/switchboard/controls/drafts/attachments/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;

    await quickQuery(`
      DELETE FROM control_draft_attachments WHERE id = $1 AND site = $2
    `, [id, site]);

    res.json({ success: true });
  } catch (e) {
    console.error('[CONTROLS] Delete draft attachment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete entire draft (with all attachments - CASCADE)
app.delete('/api/switchboard/controls/drafts/:scheduleId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { scheduleId } = req.params;

    // Delete attachments first (in case CASCADE doesn't work)
    await quickQuery(`
      DELETE FROM control_draft_attachments WHERE schedule_id = $1 AND site = $2
    `, [scheduleId, site]);

    // Delete draft
    await quickQuery(`
      DELETE FROM control_drafts WHERE schedule_id = $1 AND site = $2
    `, [scheduleId, site]);

    res.json({ success: true });
  } catch (e) {
    console.error('[CONTROLS] Delete draft error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- DASHBOARD / STATS ---

// Get control status summary
app.get('/api/switchboard/controls/dashboard', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Pending controls from control_schedules (global + by equipment type)
    const pending = await quickQuery(`
      SELECT COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date >= CURRENT_DATE AND status != 'done'
    `, [site]);

    const pendingByType = await quickQuery(`
      SELECT equipment_type, COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date >= CURRENT_DATE AND status != 'done'
      GROUP BY equipment_type
    `, [site]);

    // Overdue controls from control_schedules (global + by equipment type)
    const overdue = await quickQuery(`
      SELECT COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date < CURRENT_DATE AND status != 'done'
    `, [site]);

    const overdueByType = await quickQuery(`
      SELECT equipment_type, COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date < CURRENT_DATE AND status != 'done'
      GROUP BY equipment_type
    `, [site]);

    // === MOBILE EQUIPMENT CONTROLS (me_checks) ===
    const mobileOverdue = await quickQuery(`
      SELECT COUNT(*) as count FROM me_checks c
      JOIN me_equipments e ON c.equipment_id = e.id
      WHERE e.site = $1 AND c.due_date < CURRENT_DATE AND c.closed_at IS NULL
    `, [site]).catch(() => ({ rows: [{ count: 0 }] }));

    const mobilePending = await quickQuery(`
      SELECT COUNT(*) as count FROM me_checks c
      JOIN me_equipments e ON c.equipment_id = e.id
      WHERE e.site = $1 AND c.due_date >= CURRENT_DATE AND c.closed_at IS NULL
    `, [site]).catch(() => ({ rows: [{ count: 0 }] }));

    // === FIRE DOOR CONTROLS (fd_checks) ===
    const doorsOverdue = await quickQuery(`
      SELECT COUNT(*) as count FROM fd_checks c
      JOIN fd_doors d ON c.door_id = d.id
      WHERE d.site = $1 AND c.due_date < CURRENT_DATE AND c.closed_at IS NULL
    `, [site]).catch(() => ({ rows: [{ count: 0 }] }));

    const doorsPending = await quickQuery(`
      SELECT COUNT(*) as count FROM fd_checks c
      JOIN fd_doors d ON c.door_id = d.id
      WHERE d.site = $1 AND c.due_date >= CURRENT_DATE AND c.closed_at IS NULL
    `, [site]).catch(() => ({ rows: [{ count: 0 }] }));

    // Recent completions (last 30 days) - from control_records
    const recent = await quickQuery(`
      SELECT COUNT(*) as count FROM control_records
      WHERE site = $1 AND performed_at > NOW() - INTERVAL '30 days'
    `, [site]);

    // Templates count
    const templates = await quickQuery(`
      SELECT COUNT(*) as count FROM control_templates WHERE site = $1 AND is_active = true
    `, [site]);

    // Upcoming controls (next 7 days)
    const upcoming = await quickQuery(`
      SELECT cs.*, ct.name as template_name,
             sb.code as switchboard_code, sb.name as switchboard_name,
             d.position_number, d.name as device_name, d.switchboard_id as device_switchboard_id,
             dsb.code as device_switchboard_code,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards sb ON cs.switchboard_id = sb.id
      LEFT JOIN devices d ON cs.device_id = d.id
      LEFT JOIN switchboards dsb ON d.switchboard_id = dsb.id
      LEFT JOIN vsd_equipments vsd ON cs.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cs.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cs.mobile_equipment_id::text = me.id::text
      LEFT JOIN glo_equipments glo ON cs.glo_equipment_id::text = glo.id::text
      WHERE cs.site = $1
        AND cs.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      ORDER BY cs.next_due_date ASC
      LIMIT 10
    `, [site]);

    // Overdue list
    const overdueList = await quickQuery(`
      SELECT cs.*, ct.name as template_name,
             sb.code as switchboard_code, sb.name as switchboard_name,
             d.position_number, d.name as device_name, d.switchboard_id as device_switchboard_id,
             dsb.code as device_switchboard_code,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards sb ON cs.switchboard_id = sb.id
      LEFT JOIN devices d ON cs.device_id = d.id
      LEFT JOIN switchboards dsb ON d.switchboard_id = dsb.id
      LEFT JOIN vsd_equipments vsd ON cs.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cs.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cs.mobile_equipment_id::text = me.id::text
      LEFT JOIN glo_equipments glo ON cs.glo_equipment_id::text = glo.id::text
      WHERE cs.site = $1 AND cs.next_due_date < CURRENT_DATE
      ORDER BY cs.next_due_date ASC
      LIMIT 20
    `, [site]);

    // Build stats by equipment type
    const overdueByEquipment = {};
    const pendingByEquipment = {};
    for (const row of overdueByType.rows) {
      overdueByEquipment[row.equipment_type || 'switchboard'] = Number(row.count);
    }
    for (const row of pendingByType.rows) {
      pendingByEquipment[row.equipment_type || 'switchboard'] = Number(row.count);
    }

    // Add mobile equipment controls
    const mobileOverdueCount = Number(mobileOverdue.rows[0]?.count || 0);
    const mobilePendingCount = Number(mobilePending.rows[0]?.count || 0);
    if (mobileOverdueCount > 0) overdueByEquipment['mobile_equipment'] = mobileOverdueCount;
    if (mobilePendingCount > 0) pendingByEquipment['mobile_equipment'] = mobilePendingCount;

    // Add fire door controls
    const doorsOverdueCount = Number(doorsOverdue.rows[0]?.count || 0);
    const doorsPendingCount = Number(doorsPending.rows[0]?.count || 0);
    if (doorsOverdueCount > 0) overdueByEquipment['doors'] = doorsOverdueCount;
    if (doorsPendingCount > 0) pendingByEquipment['doors'] = doorsPendingCount;

    // Calculate totals including all sources
    const totalOverdue = Number(overdue.rows[0]?.count || 0) + mobileOverdueCount + doorsOverdueCount;
    const totalPending = Number(pending.rows[0]?.count || 0) + mobilePendingCount + doorsPendingCount;

    res.json({
      stats: {
        pending: totalPending,
        overdue: totalOverdue,
        completed_30d: Number(recent.rows[0]?.count || 0),
        templates: Number(templates.rows[0]?.count || 0),
        // Stats by equipment type for dashboard badges
        overdueByEquipment,
        pendingByEquipment
      },
      upcoming: upcoming.rows,
      overdue_list: overdueList.rows
    });
  } catch (e) {
    console.error('[CONTROLS] Dashboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// LIST ALL EQUIPMENT BY TYPE (for scheduling controls)
// ============================================================
app.get('/api/switchboard/controls/equipment', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { type } = req.query; // switchboard, vsd, meca, mobile_equipment, hv, glo

    const results = {};

    // Switchboards (always include)
    if (!type || type === 'switchboard' || type === 'all') {
      const sbRes = await quickQuery(`
        SELECT id, code, name, building_code, floor, room
        FROM switchboards WHERE site = $1 ORDER BY code
      `, [site]);
      results.switchboards = sbRes.rows;
    }

    // VSD Equipment - has 'site' column (text), 'manufacturer' (not brand), 'location'
    if (!type || type === 'vsd' || type === 'all') {
      try {
        const vsdRes = await quickQuery(`
          SELECT id, name, building, floor, location, serial_number, manufacturer
          FROM vsd_equipments WHERE site = $1 ORDER BY name
        `, [site]);
        results.vsd = vsdRes.rows;
      } catch (e) {
        results.vsd = [];
      }
    }

    // MECA Equipment - uses site_id (integer), need to join with sites table
    // Include category info for filtering by category
    if (!type || type === 'meca' || type === 'all') {
      try {
        const mecaRes = await quickQuery(`
          SELECT e.id, e.name, e.building, e.floor, e.location, e.serial_number, e.manufacturer,
                 e.category_id, c.name as category_name
          FROM meca_equipments e
          INNER JOIN sites s ON s.id = e.site_id
          LEFT JOIN meca_equipment_categories c ON c.id = e.category_id
          WHERE s.name = $1
            AND (c.assign_to_controls = true OR e.category_id IS NULL)
          ORDER BY e.name
        `, [site]);
        results.meca = mecaRes.rows;
      } catch (e) {
        results.meca = [];
      }
    }

    // Mobile Equipment - no site column, return all equipments
    if (!type || type === 'mobile_equipment' || type === 'all') {
      try {
        const mobileRes = await quickQuery(`
          SELECT id, name, building, floor, serial_number, brand, model
          FROM me_equipments ORDER BY name LIMIT 100
        `, []);
        results.mobile_equipment = mobileRes.rows;
      } catch (e) {
        results.mobile_equipment = [];
      }
    }

    // HV Equipment - has 'site' column
    if (!type || type === 'hv' || type === 'all') {
      try {
        const hvRes = await quickQuery(`
          SELECT id, name, code, building_code, floor, regime_neutral, is_principal
          FROM hv_equipments WHERE site = $1 ORDER BY name
        `, [site]);
        results.hv = hvRes.rows;
      } catch (e) {
        results.hv = [];
      }
    }

    // GLO Equipment - uses site_id (integer), join with sites
    if (!type || type === 'glo' || type === 'all') {
      try {
        const gloRes = await quickQuery(`
          SELECT e.id, e.name, e.building, e.floor, e.location, e.serial_number, e.manufacturer
          FROM glo_equipments e
          INNER JOIN sites s ON s.id = e.site_id
          WHERE s.name = $1 ORDER BY e.name
        `, [site]);
        results.glo = gloRes.rows;
      } catch (e) {
        results.glo = [];
      }
    }

    // Datahub Equipment - items from categories with assign_to_controls = true
    if (!type || type === 'datahub' || type === 'all') {
      try {
        const datahubRes = await quickQuery(`
          SELECT i.id, i.name, i.code, i.building, i.floor, i.location, i.description,
                 i.category_id, c.name as category_name, c.color as category_color, c.icon as category_icon
          FROM dh_items i
          INNER JOIN dh_categories c ON c.id = i.category_id
          WHERE c.assign_to_controls = true
          ORDER BY c.name, i.name
        `, []);
        results.datahub = datahubRes.rows;
      } catch (e) {
        console.log('[CONTROLS] Datahub equipment query error (table may not exist):', e.message);
        results.datahub = [];
      }
    }

    res.json(results);
  } catch (e) {
    console.error('[CONTROLS] List equipment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// SWITCHBOARDS WITH DDR COUNT (for DDR-specific control scheduling)
// ============================================================
app.get('/api/switchboard/controls/switchboards-with-ddr', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Get switchboards with their DDR count
    const { rows } = await quickQuery(`
      SELECT
        s.id, s.code, s.name, s.building_code, s.floor, s.room,
        COUNT(d.id) FILTER (WHERE d.is_differential = true) as ddr_count,
        COUNT(d.id) as total_devices
      FROM switchboards s
      LEFT JOIN devices d ON d.switchboard_id = s.id
      WHERE s.site = $1
      GROUP BY s.id, s.code, s.name, s.building_code, s.floor, s.room
      HAVING COUNT(d.id) FILTER (WHERE d.is_differential = true) > 0
      ORDER BY s.code
    `, [site]);

    res.json({ switchboards: rows });
  } catch (e) {
    console.error('[CONTROLS] Switchboards with DDR error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get DDR devices for specific switchboards (for control scheduling)
app.get('/api/switchboard/controls/ddr-devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { switchboard_ids } = req.query;
    if (!switchboard_ids) return res.status(400).json({ error: 'switchboard_ids required' });

    const ids = switchboard_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    if (ids.length === 0) return res.json({ devices: {} });

    // Get DDR devices grouped by switchboard
    const { rows } = await quickQuery(`
      SELECT
        d.id, d.name, d.switchboard_id, d.position_number,
        d.differential_sensitivity_ma, d.differential_type
      FROM devices d
      INNER JOIN switchboards s ON s.id = d.switchboard_id
      WHERE s.site = $1 AND d.switchboard_id = ANY($2) AND d.is_differential = true
      ORDER BY d.switchboard_id, d.position_number
    `, [site, ids]);

    // Group by switchboard_id
    const devicesBySwitchboard = {};
    rows.forEach(d => {
      if (!devicesBySwitchboard[d.switchboard_id]) {
        devicesBySwitchboard[d.switchboard_id] = [];
      }
      devicesBySwitchboard[d.switchboard_id].push(d);
    });

    res.json({ devices: devicesBySwitchboard });
  } catch (e) {
    console.error('[CONTROLS] DDR devices error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get device controls for a specific switchboard (to display on Switchboards page)
app.get('/api/switchboard/controls/device-controls-by-board/:boardId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { boardId } = req.params;

    // Get all device control schedules for devices in this switchboard
    const { rows } = await quickQuery(`
      SELECT
        cs.id as schedule_id,
        cs.device_id,
        cs.next_due_date,
        cs.status,
        ct.id as template_id,
        ct.name as template_name,
        ct.frequency_months,
        ct.element_filter
      FROM control_schedules cs
      INNER JOIN control_templates ct ON cs.template_id = ct.id
      INNER JOIN devices d ON cs.device_id = d.id
      WHERE cs.site = $1 AND d.switchboard_id = $2 AND cs.device_id IS NOT NULL
      ORDER BY cs.next_due_date
    `, [site, boardId]);

    // Group by device_id and calculate status
    const now = new Date();
    const controlsByDevice = {};

    rows.forEach(r => {
      if (!controlsByDevice[r.device_id]) {
        controlsByDevice[r.device_id] = {
          controls: [],
          status: 'ok',
          next_due: null,
          overdue_count: 0,
          pending_count: 0
        };
      }

      const isOverdue = r.next_due_date && new Date(r.next_due_date) < now;
      const control = {
        schedule_id: r.schedule_id,
        template_id: r.template_id,
        template_name: r.template_name,
        frequency_months: r.frequency_months,
        element_filter: r.element_filter,
        next_due_date: r.next_due_date,
        is_overdue: isOverdue
      };

      controlsByDevice[r.device_id].controls.push(control);

      if (isOverdue) {
        controlsByDevice[r.device_id].overdue_count++;
        controlsByDevice[r.device_id].status = 'overdue';
      } else if (r.next_due_date) {
        controlsByDevice[r.device_id].pending_count++;
        if (controlsByDevice[r.device_id].status !== 'overdue') {
          controlsByDevice[r.device_id].status = 'pending';
        }
      }

      // Track earliest due date
      if (r.next_due_date) {
        if (!controlsByDevice[r.device_id].next_due ||
            new Date(r.next_due_date) < new Date(controlsByDevice[r.device_id].next_due)) {
          controlsByDevice[r.device_id].next_due = r.next_due_date;
        }
      }
    });

    res.json({ controls: controlsByDevice });
  } catch (e) {
    console.error('[CONTROLS] Device controls by board error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get existing control dates by frequency for a switchboard (for date alignment)
// Looks at SWITCHBOARD controls (not device controls) to suggest alignment
app.get('/api/switchboard/controls/existing-dates/:boardId', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { boardId } = req.params;

    // Get switchboard controls with their frequency and next_due_date
    const { rows } = await quickQuery(`
      SELECT
        ct.frequency_months,
        ct.name as template_name,
        cs.next_due_date
      FROM control_schedules cs
      INNER JOIN control_templates ct ON cs.template_id = ct.id
      WHERE cs.site = $1 AND cs.switchboard_id = $2
      ORDER BY ct.frequency_months, cs.next_due_date
    `, [site, boardId]);

    // Group by frequency
    const datesByFrequency = {};
    const controlsByFrequency = {};

    rows.forEach(r => {
      const freq = r.frequency_months;
      const dateStr = r.next_due_date ? r.next_due_date.toISOString().split('T')[0] : null;

      if (!datesByFrequency[freq]) {
        datesByFrequency[freq] = dateStr;
        controlsByFrequency[freq] = {
          template_name: r.template_name,
          next_due_date: dateStr,
          frequency_months: freq
        };
      }
    });

    res.json({
      dates_by_frequency: datesByFrequency,
      controls_by_frequency: controlsByFrequency,
      has_controls: rows.length > 0
    });
  } catch (e) {
    console.error('[CONTROLS] Existing dates error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get control status for a specific switchboard/device
app.get('/api/switchboard/controls/status', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { switchboard_id, device_id } = req.query;

    let sql = `
      SELECT cs.*, ct.name as template_name
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      WHERE cs.site = $1
    `;
    const params = [site];
    let idx = 2;

    if (switchboard_id) {
      sql += ` AND cs.switchboard_id = $${idx++}`;
      params.push(switchboard_id);
    }
    if (device_id) {
      sql += ` AND cs.device_id = $${idx++}`;
      params.push(device_id);
    }

    const { rows } = await quickQuery(sql, params);

    // Calculate status
    const now = new Date();
    let hasOverdue = false;
    let hasPending = false;

    rows.forEach(r => {
      if (r.next_due_date) {
        if (new Date(r.next_due_date) < now) hasOverdue = true;
        else hasPending = true;
      }
    });

    res.json({
      schedules: rows,
      status: hasOverdue ? 'overdue' : (hasPending ? 'pending' : 'ok'),
      has_controls: rows.length > 0
    });
  } catch (e) {
    console.error('[CONTROLS] Get status error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- PDF GENERATION ---

// Generate control report PDF
app.get('/api/switchboard/controls/records/:id/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;

    // Get record with all details
    const recordRes = await quickQuery(`
      SELECT cr.*,
             ct.name as template_name, ct.checklist_items as template_items,
             sb.name as switchboard_name, sb.code as switchboard_code,
             sb.building_code, sb.floor, sb.room,
             d.name as device_name, d.position_number, d.manufacturer, d.reference
      FROM control_records cr
      LEFT JOIN control_templates ct ON cr.template_id = ct.id
      LEFT JOIN switchboards sb ON cr.switchboard_id = sb.id
      LEFT JOIN devices d ON cr.device_id = d.id
      WHERE cr.id = $1 AND cr.site = $2
    `, [id, site]);

    if (!recordRes.rows.length) return res.status(404).json({ error: 'Record not found' });
    const record = recordRes.rows[0];

    // Get attachments
    const attachments = await quickQuery(`
      SELECT * FROM control_attachments WHERE control_record_id = $1
    `, [id]);

    // Get site settings for logo
    const settings = await quickQuery(`SELECT * FROM site_settings WHERE site = $1`, [site]);
    const siteSettings = settings.rows[0] || {};

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="control_${record.switchboard_code || record.device_position || id}.pdf"`);
    doc.pipe(res);

    // Header with logo
    let headerY = 50;
    if (siteSettings.logo) {
      try {
        doc.image(siteSettings.logo, 50, headerY, { width: 70 });
      } catch (e) { /* ignore */ }
    }

    // Title - centered properly
    doc.fontSize(18).fillColor('#1e40af').text('RAPPORT DE CONTRÔLE', 140, headerY + 5, { width: 260, align: 'center' });
    doc.fontSize(9).fillColor('#6b7280').text(siteSettings.company_name || site, 140, headerY + 28, { width: 260, align: 'center' });

    // Status badge - positioned on the right with proper spacing
    const statusColors = { conform: '#059669', non_conform: '#dc2626', partial: '#d97706' };
    const statusLabels = { conform: 'CONFORME', non_conform: 'NON CONFORME', partial: 'PARTIEL' };
    const badgeWidth = record.status === 'non_conform' ? 95 : 75;
    doc.rect(545 - badgeWidth, headerY + 5, badgeWidth, 22).fill(statusColors[record.status] || '#6b7280');
    doc.fontSize(9).fillColor('#ffffff').text(statusLabels[record.status] || record.status, 548 - badgeWidth, headerY + 12, { width: badgeWidth - 6, align: 'center' });

    // Info box - moved down slightly
    let y = 100;
    doc.rect(50, y, 495, 85).fill('#f3f4f6');
    doc.fontSize(10).fillColor('#374151');

    const target = record.switchboard_id
      ? `Tableau: ${record.switchboard_code || ''} - ${record.switchboard_name || ''}`
      : `Disjoncteur: ${record.device_position || ''} - ${record.device_name || ''}`;

    doc.text(target, 60, y + 12);
    doc.text(`Modèle: ${record.template_name || '-'}`, 60, y + 28);
    doc.text(`Contrôlé par: ${record.performed_by} (${record.performed_by_email || '-'})`, 60, y + 44);
    doc.text(`Date: ${new Date(record.performed_at).toLocaleDateString('fr-FR')} à ${new Date(record.performed_at).toLocaleTimeString('fr-FR')}`, 60, y + 60);

    if (record.building_code) {
      doc.text(`Localisation: ${record.building_code} - Étage ${record.floor || '-'} - Local ${record.room || '-'}`, 300, y + 12);
    }

    // Checklist results
    y = 205;
    doc.fontSize(14).fillColor('#1e40af').text('Résultats du contrôle', 50, y);
    y += 25;

    const checklistResults = record.checklist_results || [];
    const templateItems = record.template_items || [];

    // Create a map of template items
    const itemMap = new Map();
    templateItems.forEach(item => itemMap.set(item.id, item));

    // Table header
    doc.rect(50, y, 495, 22).fill('#e5e7eb');
    doc.fontSize(9).fillColor('#374151');
    doc.text('Point de controle', 55, y + 6);
    doc.text('Resultat', 355, y + 6);
    doc.text('Valeur', 450, y + 6);
    y += 22;

    // Table rows
    const resultColors = { conform: '#059669', non_conform: '#dc2626', na: '#9ca3af' };
    const resultLabels = { conform: 'CONFORME', non_conform: 'NON CONFORME', na: 'N/A' };

    checklistResults.forEach((result, idx) => {
      const item = itemMap.get(result.item_id) || { label: `Item ${idx + 1}` };
      const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(50, y, 495, 20).fill(bgColor);

      doc.fontSize(8).fillColor('#374151').text(item.label || '-', 55, y + 6, { width: 280 });

      // Status indicator with colored bullet
      const statusColor = resultColors[result.status] || '#374151';
      doc.circle(353, y + 10, 4).fill(statusColor);
      doc.fontSize(8).fillColor(statusColor).text(resultLabels[result.status] || result.status, 362, y + 6);

      doc.fillColor('#374151').text(result.value ? `${result.value} ${item.unit || ''}` : '-', 445, y + 6);

      y += 20;
      if (y > 750) { doc.addPage(); y = 50; }
    });

    // Devices list (if switchboard control)
    if (record.switchboard_id) {
      const devicesRes = await quickQuery(`
        SELECT position_number, name, manufacturer, reference, in_amps, icu_ka, poles
        FROM devices
        WHERE switchboard_id = $1
        ORDER BY (NULLIF(regexp_replace(position_number, '[^0-9.]', '', 'g'), ''))::numeric NULLS LAST, name
      `, [record.switchboard_id]);

      if (devicesRes.rows.length > 0) {
        if (y > 600) { doc.addPage(); y = 50; }
        y += 20;
        doc.fontSize(14).fillColor('#1e40af').text(`Disjoncteurs du tableau (${devicesRes.rows.length})`, 50, y);
        y += 25;

        // Table header
        doc.rect(50, y, 495, 20).fill('#e5e7eb');
        doc.fontSize(8).fillColor('#374151');
        doc.text('N°', 55, y + 6, { width: 30 });
        doc.text('Nom', 85, y + 6, { width: 120 });
        doc.text('Fabricant', 210, y + 6, { width: 80 });
        doc.text('Référence', 295, y + 6, { width: 100 });
        doc.text('In (A)', 400, y + 6, { width: 40 });
        doc.text('Icu (kA)', 445, y + 6, { width: 40 });
        doc.text('Pôles', 490, y + 6, { width: 40 });
        y += 20;

        // Table rows
        devicesRes.rows.forEach((device, idx) => {
          const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
          doc.rect(50, y, 495, 18).fill(bgColor);
          doc.fontSize(7).fillColor('#374151');
          doc.text(device.position_number || '-', 55, y + 5, { width: 30 });
          doc.text(device.name || '-', 85, y + 5, { width: 120 });
          doc.text(device.manufacturer || '-', 210, y + 5, { width: 80 });
          doc.text(device.reference || '-', 295, y + 5, { width: 100 });
          doc.text(device.in_amps || '-', 400, y + 5, { width: 40 });
          doc.text(device.icu_ka || '-', 445, y + 5, { width: 40 });
          doc.text(device.poles || '-', 490, y + 5, { width: 40 });
          y += 18;
          if (y > 750) { doc.addPage(); y = 50; }
        });
        y += 10;
      }
    }

    // Notes
    if (record.global_notes) {
      if (y > 700) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(12).fillColor('#1e40af').text('Observations', 50, y);
      y += 18;
      doc.fontSize(10).fillColor('#374151').text(record.global_notes, 50, y, { width: 495 });
      y += doc.heightOfString(record.global_notes, { width: 495 }) + 10;
    }

    // Photos Section - Improved layout
    if (attachments.rows.length > 0) {
      const photos = attachments.rows.filter(a => a.file_type === 'photo' && a.file_data);
      const documents = attachments.rows.filter(a => a.file_type === 'document');

      if (photos.length > 0) {
        if (y > 550) { doc.addPage(); y = 50; }
        y += 15;

        // Section header with gradient background
        doc.rect(50, y, 495, 28).fill('#eff6ff');
        doc.fontSize(13).fillColor('#1e40af').text('PHOTOS DU CONTROLE', 60, y + 7);
        doc.fontSize(9).fillColor('#6b7280').text(`(${photos.length} photo${photos.length > 1 ? 's' : ''})`, 230, y + 9);
        y += 38;

        // Grid layout - 2 photos per row with larger size
        const photoWidth = 235;
        const photoHeight = 160;
        const gap = 15;

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const col = i % 2;
          const x = 50 + col * (photoWidth + gap);

          // Check page break - add new page if needed
          if (i % 2 === 0 && y + photoHeight + 30 > 750) {
            doc.addPage();
            y = 50;
          }

          try {
            // Photo frame with shadow effect
            doc.rect(x - 2, y - 2, photoWidth + 4, photoHeight + 4)
               .fillAndStroke('#f8fafc', '#e2e8f0');

            // Photo
            doc.image(photo.file_data, x, y, {
              width: photoWidth,
              height: photoHeight,
              fit: [photoWidth, photoHeight],
              align: 'center',
              valign: 'center'
            });

            // Caption below photo
            if (photo.caption) {
              doc.fontSize(8).fillColor('#4b5563')
                 .text(photo.caption, x, y + photoHeight + 4, {
                   width: photoWidth,
                   align: 'center',
                   lineBreak: true
                 });
            }
          } catch (e) {
            // Show placeholder if image fails
            doc.rect(x, y, photoWidth, photoHeight).fill('#f3f4f6');
            doc.fontSize(10).fillColor('#9ca3af')
               .text('Image non disponible', x, y + photoHeight/2 - 5, { width: photoWidth, align: 'center' });
          }

          // Move to next row after 2 photos
          if (col === 1) {
            y += photoHeight + (photos[i]?.caption ? 25 : 15);
          }
        }

        // Handle odd number of photos
        if (photos.length % 2 !== 0) {
          y += photoHeight + (photos[photos.length - 1]?.caption ? 25 : 15);
        }
      }

      // Documents Section - Links
      if (documents.length > 0) {
        if (y > 680) { doc.addPage(); y = 50; }
        y += 15;

        // Section header
        doc.rect(50, y, 495, 28).fill('#fef3c7');
        doc.fontSize(13).fillColor('#92400e').text('DOCUMENTS JOINTS', 60, y + 7);
        doc.fontSize(9).fillColor('#78716c').text(`(${documents.length} fichier${documents.length > 1 ? 's' : ''})`, 220, y + 9);
        y += 38;

        // Info note about accessing documents
        doc.rect(50, y, 495, 24).fill('#fef9c3');
        doc.fontSize(8).fillColor('#854d0e')
           .text('Les documents sont consultables dans l\'application web - Section Controles > Historique', 60, y + 8, { width: 475 });
        y += 32;

        // List documents
        for (const doc_file of documents) {
          if (y > 750) { doc.addPage(); y = 50; }

          // Document item with bullet
          doc.rect(50, y, 495, 24).fill('#fffbeb');
          doc.circle(60, y + 12, 3).fill('#92400e');
          doc.fontSize(10).fillColor('#374151')
             .text(doc_file.file_name || 'Document', 70, y + 7, { width: 280 });

          if (doc_file.caption) {
            doc.fontSize(8).fillColor('#6b7280')
               .text(doc_file.caption, 300, y + 8, { width: 230, align: 'right' });
          }
          y += 28;
        }
      }
    }

    // Signature
    if (record.signature_base64) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 30;
      doc.fontSize(10).fillColor('#374151').text('Signature:', 50, y);
      try {
        const sigBuffer = Buffer.from(record.signature_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        doc.image(sigBuffer, 50, y + 15, { width: 150 });
      } catch (e) { /* ignore */ }
    }

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af').text(
        `Contrôle ${target} - ${new Date(record.performed_at).toLocaleDateString('fr-FR')} - Page ${i + 1}/${range.count}`,
        50, 820, { align: 'center', width: 495 }
      );
    }

    doc.end();
  } catch (e) {
    console.error('[CONTROLS] PDF generation error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' });
  }
});

// ============================================================
// BULK CONTROLS REPORT PDF - Export filtered controls
// ============================================================
app.get('/api/switchboard/controls/report/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Parse filters from query params
    const {
      switchboard_ids,
      template_ids,
      buildings,
      status,
      date_from,
      date_to,
      performers,
      equipment_type, // 'switchboard', 'device', 'vsd', 'meca', 'mobile', 'hv', 'glo', 'datahub'
      include_devices // 'true' to include device table for switchboard controls
    } = req.query;

    // Build dynamic query with filters
    let query = `
      SELECT cr.*,
             ct.name as template_name, ct.checklist_items as template_items, ct.target_type,
             sb.name as switchboard_name, sb.code as switchboard_code,
             sb.building_code, sb.floor, sb.room,
             d.name as device_name, d.position_number as device_position,
             vsd.tag as vsd_tag, vsd.designation as vsd_designation,
             meca.tag as meca_tag, meca.designation as meca_designation,
             mobile.tag as mobile_tag, mobile.designation as mobile_designation,
             hv.tag as hv_tag, hv.designation as hv_designation,
             glo.tag as glo_tag, glo.designation as glo_designation,
             dh.name as datahub_name
      FROM control_records cr
      LEFT JOIN control_templates ct ON cr.template_id = ct.id
      LEFT JOIN switchboards sb ON cr.switchboard_id = sb.id
      LEFT JOIN devices d ON cr.device_id = d.id
      LEFT JOIN vsd_equipment vsd ON cr.vsd_equipment_id = vsd.id
      LEFT JOIN meca_equipment meca ON cr.meca_equipment_id = meca.id
      LEFT JOIN mobile_equipment mobile ON cr.mobile_equipment_id = mobile.id
      LEFT JOIN hv_equipment hv ON cr.hv_equipment_id = hv.id
      LEFT JOIN glo_equipment glo ON cr.glo_equipment_id = glo.id
      LEFT JOIN datahub_equipment dh ON cr.datahub_equipment_id = dh.id
      WHERE cr.site = $1
    `;
    const params = [site];
    let paramIdx = 2;

    // Apply filters
    if (switchboard_ids) {
      const ids = switchboard_ids.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length) {
        query += ` AND cr.switchboard_id = ANY($${paramIdx++}::int[])`;
        params.push(ids);
      }
    }
    if (template_ids) {
      const ids = template_ids.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length) {
        query += ` AND cr.template_id = ANY($${paramIdx++}::int[])`;
        params.push(ids);
      }
    }
    if (buildings) {
      const bldgs = buildings.split(',').filter(Boolean);
      if (bldgs.length) {
        query += ` AND sb.building_code = ANY($${paramIdx++}::text[])`;
        params.push(bldgs);
      }
    }
    if (status && status !== 'all') {
      query += ` AND cr.status = $${paramIdx++}`;
      params.push(status);
    }
    if (date_from) {
      query += ` AND cr.performed_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND cr.performed_at <= $${paramIdx++}`;
      params.push(date_to + 'T23:59:59');
    }
    if (performers) {
      const perfs = performers.split(',').filter(Boolean);
      if (perfs.length) {
        query += ` AND cr.performed_by = ANY($${paramIdx++}::text[])`;
        params.push(perfs);
      }
    }
    if (equipment_type) {
      switch (equipment_type) {
        case 'switchboard':
          query += ` AND cr.switchboard_id IS NOT NULL AND cr.device_id IS NULL`;
          break;
        case 'device':
          query += ` AND cr.device_id IS NOT NULL`;
          break;
        case 'vsd':
          query += ` AND cr.vsd_equipment_id IS NOT NULL`;
          break;
        case 'meca':
          query += ` AND cr.meca_equipment_id IS NOT NULL`;
          break;
        case 'mobile':
          query += ` AND cr.mobile_equipment_id IS NOT NULL`;
          break;
        case 'hv':
          query += ` AND cr.hv_equipment_id IS NOT NULL`;
          break;
        case 'glo':
          query += ` AND cr.glo_equipment_id IS NOT NULL`;
          break;
        case 'datahub':
          query += ` AND cr.datahub_equipment_id IS NOT NULL`;
          break;
      }
    }

    query += ` ORDER BY cr.performed_at DESC LIMIT 500`;

    const recordsRes = await quickQuery(query, params);
    const records = recordsRes.rows;

    if (records.length === 0) {
      return res.status(404).json({ error: 'Aucun contrôle trouvé avec ces filtres' });
    }

    // Get site settings
    const settings = await quickQuery(`SELECT logo, company_name FROM site_settings WHERE site = $1`, [site]);
    const siteSettings = settings.rows[0] || {};

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    const filename = `rapport_controles_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ═══════════════════════════════════════════════════════════════════
    // COLORS - Green theme matching listing exports
    // ═══════════════════════════════════════════════════════════════════
    const colors = {
      primary: '#30EA03',
      primaryDark: '#22c55e',
      blue: '#3b82f6',
      blueDark: '#1e40af',
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#dc2626',
      gray: '#6b7280',
      grayLight: '#f3f4f6',
      grayBorder: '#e5e7eb',
      text: '#111827',
      textMuted: '#6b7280',
    };

    const statusColors = { conform: '#059669', non_conform: '#dc2626', partial: '#d97706' };
    const statusLabels = { conform: 'CONFORME', non_conform: 'NON CONFORME', partial: 'PARTIEL' };

    // ═══════════════════════════════════════════════════════════════════
    // HEADER FUNCTION - Reusable for each page
    // ═══════════════════════════════════════════════════════════════════
    const drawHeader = () => {
      doc.rect(0, 0, 595, 70).fillColor(colors.primary).fill();
      doc.rect(0, 63, 595, 7).fillColor(colors.primaryDark).fill();

      let textStartX = 50;
      if (siteSettings.logo) {
        try {
          doc.image(siteSettings.logo, 45, 8, { fit: [50, 50], align: 'center', valign: 'center' });
          textStartX = 110;
        } catch (e) {}
      }

      doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
      doc.text('RAPPORT DE CONTROLES', textStartX, 14, { width: 300 });

      doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.9)');
      doc.text(siteSettings.company_name || site, textStartX, 38);

      // Date
      doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.8)');
      doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, 400, 20, { align: 'right', width: 150 });

      // Stats badge
      doc.roundedRect(400, 38, 150, 22, 4).fillColor('rgba(255,255,255,0.2)').fill();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff');
      doc.text(`${records.length} contrôle${records.length > 1 ? 's' : ''}`, 400, 44, { width: 150, align: 'center' });
    };

    drawHeader();

    // ═══════════════════════════════════════════════════════════════════
    // STATISTICS SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    let y = 90;

    // Count by status
    const conformCount = records.filter(r => r.status === 'conform').length;
    const nonConformCount = records.filter(r => r.status === 'non_conform').length;
    const partialCount = records.filter(r => r.status === 'partial').length;

    // Summary cards
    const cardWidth = 165;
    const cardHeight = 40;
    const gap = 10;
    const startX = 50;

    // Conforme
    doc.roundedRect(startX, y, cardWidth, cardHeight, 6).fillColor('#ecfdf5').fill();
    doc.rect(startX, y + 4, 3, cardHeight - 8).fillColor(colors.success).fill();
    doc.font('Helvetica').fontSize(8).fillColor(colors.textMuted).text('Conformes', startX + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(colors.success).text(conformCount.toString(), startX + 12, y + 20);

    // Non conforme
    doc.roundedRect(startX + cardWidth + gap, y, cardWidth, cardHeight, 6).fillColor('#fef2f2').fill();
    doc.rect(startX + cardWidth + gap, y + 4, 3, cardHeight - 8).fillColor(colors.danger).fill();
    doc.font('Helvetica').fontSize(8).fillColor(colors.textMuted).text('Non conformes', startX + cardWidth + gap + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(colors.danger).text(nonConformCount.toString(), startX + cardWidth + gap + 12, y + 20);

    // Partiels
    doc.roundedRect(startX + 2 * (cardWidth + gap), y, cardWidth, cardHeight, 6).fillColor('#fef3c7').fill();
    doc.rect(startX + 2 * (cardWidth + gap), y + 4, 3, cardHeight - 8).fillColor(colors.warning).fill();
    doc.font('Helvetica').fontSize(8).fillColor(colors.textMuted).text('Partiels', startX + 2 * (cardWidth + gap) + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(colors.warning).text(partialCount.toString(), startX + 2 * (cardWidth + gap) + 12, y + 20);

    y += cardHeight + 20;

    // ═══════════════════════════════════════════════════════════════════
    // CONTROLS TABLE
    // ═══════════════════════════════════════════════════════════════════
    doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.blueDark).text('Liste des controles', 50, y);
    y += 20;

    // Table header
    doc.rect(40, y, 515, 22).fillColor(colors.grayLight).fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.text);
    doc.text('Date', 45, y + 7, { width: 55 });
    doc.text('Equipement', 105, y + 7, { width: 130 });
    doc.text('Modele', 240, y + 7, { width: 100 });
    doc.text('Controleur', 345, y + 7, { width: 90 });
    doc.text('Statut', 440, y + 7, { width: 70 });
    doc.text('Pts', 515, y + 7, { width: 35, align: 'center' });
    y += 22;

    // Table rows
    for (const record of records) {
      if (y > 750) {
        doc.addPage();
        drawHeader();
        y = 90;
        // Re-draw table header
        doc.rect(40, y, 515, 22).fillColor(colors.grayLight).fill();
        doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.text);
        doc.text('Date', 45, y + 7, { width: 55 });
        doc.text('Equipement', 105, y + 7, { width: 130 });
        doc.text('Modele', 240, y + 7, { width: 100 });
        doc.text('Controleur', 345, y + 7, { width: 90 });
        doc.text('Statut', 440, y + 7, { width: 70 });
        doc.text('Pts', 515, y + 7, { width: 35, align: 'center' });
        y += 22;
      }

      const rowHeight = 18;
      const bgColor = records.indexOf(record) % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(40, y, 515, rowHeight).fillColor(bgColor).fill();

      // Get equipment name
      let equipName = '-';
      if (record.switchboard_id && !record.device_id) {
        equipName = `⚡ ${record.switchboard_code || record.switchboard_name || '-'}`;
      } else if (record.device_id) {
        equipName = `🔌 ${record.device_position || ''} - ${record.device_name || '-'}`;
      } else if (record.vsd_equipment_id) {
        equipName = `⚙️ ${record.vsd_tag || record.vsd_designation || '-'}`;
      } else if (record.meca_equipment_id) {
        equipName = `🔧 ${record.meca_tag || record.meca_designation || '-'}`;
      } else if (record.mobile_equipment_id) {
        equipName = `🚜 ${record.mobile_tag || record.mobile_designation || '-'}`;
      } else if (record.hv_equipment_id) {
        equipName = `⚡ ${record.hv_tag || record.hv_designation || '-'}`;
      } else if (record.glo_equipment_id) {
        equipName = `🔋 ${record.glo_tag || record.glo_designation || '-'}`;
      } else if (record.datahub_equipment_id) {
        equipName = `📊 ${record.datahub_name || '-'}`;
      }

      doc.font('Helvetica').fontSize(7).fillColor(colors.text);
      doc.text(new Date(record.performed_at).toLocaleDateString('fr-FR'), 45, y + 5, { width: 55 });
      doc.text(equipName.substring(0, 28), 105, y + 5, { width: 130 });
      doc.text((record.template_name || '-').substring(0, 22), 240, y + 5, { width: 100 });
      doc.text((record.performed_by || '-').substring(0, 18), 345, y + 5, { width: 90 });

      // Status with color
      const statusColor = statusColors[record.status] || colors.gray;
      doc.roundedRect(440, y + 3, 60, 12, 3).fillColor(statusColor).fill();
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff');
      doc.text(statusLabels[record.status] || record.status, 440, y + 6, { width: 60, align: 'center' });

      // Checklist points count
      const points = (record.checklist_results || []).length;
      doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted);
      doc.text(points.toString(), 515, y + 5, { width: 35, align: 'center' });

      y += rowHeight;
    }

    // ═══════════════════════════════════════════════════════════════════
    // DETAILED SWITCHBOARD CONTROLS (if include_devices=true)
    // ═══════════════════════════════════════════════════════════════════
    if (include_devices === 'true') {
      // Group records by switchboard
      const switchboardRecords = records.filter(r => r.switchboard_id && !r.device_id);
      const switchboardIds = [...new Set(switchboardRecords.map(r => r.switchboard_id))];

      for (const sbId of switchboardIds) {
        const sbRecords = switchboardRecords.filter(r => r.switchboard_id === sbId);
        if (sbRecords.length === 0) continue;

        const sbInfo = sbRecords[0];

        // Get device controls for this switchboard
        const deviceControlsRes = await quickQuery(`
          SELECT cr.*, d.position_number, d.name as device_name, d.manufacturer, d.reference, d.in_amps,
                 ct.name as template_name
          FROM control_records cr
          JOIN devices d ON cr.device_id = d.id
          LEFT JOIN control_templates ct ON cr.template_id = ct.id
          WHERE d.switchboard_id = $1 AND cr.site = $2
          ORDER BY (NULLIF(regexp_replace(d.position_number, '[^0-9.]', '', 'g'), ''))::numeric NULLS LAST, cr.performed_at DESC
        `, [sbId, site]);

        const deviceControls = deviceControlsRes.rows;

        // New page for switchboard detail
        doc.addPage();
        drawHeader();
        y = 90;

        // Switchboard title
        doc.roundedRect(40, y, 515, 35, 6).fillColor('#eff6ff').fill();
        doc.font('Helvetica-Bold').fontSize(14).fillColor(colors.blueDark);
        doc.text(`⚡ ${sbInfo.switchboard_code || ''} - ${sbInfo.switchboard_name || ''}`, 50, y + 8);
        doc.font('Helvetica').fontSize(9).fillColor(colors.textMuted);
        const location = [sbInfo.building_code, sbInfo.floor ? `Étage ${sbInfo.floor}` : null, sbInfo.room].filter(Boolean).join(' - ');
        doc.text(location || '-', 50, y + 22);
        y += 45;

        // Switchboard control summary
        doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text).text('Contrôles du tableau', 50, y);
        y += 18;

        for (const ctrl of sbRecords) {
          if (y > 720) { doc.addPage(); drawHeader(); y = 90; }

          const rowBg = ctrl.status === 'conform' ? '#ecfdf5' : ctrl.status === 'non_conform' ? '#fef2f2' : '#fef3c7';
          doc.roundedRect(40, y, 515, 30, 4).fillColor(rowBg).fill();

          doc.font('Helvetica').fontSize(8).fillColor(colors.text);
          doc.text(`📅 ${new Date(ctrl.performed_at).toLocaleDateString('fr-FR')}`, 50, y + 6);
          doc.text(`👤 ${ctrl.performed_by}`, 150, y + 6);
          doc.text(`📋 ${ctrl.template_name || '-'}`, 280, y + 6);

          const sColor = statusColors[ctrl.status] || colors.gray;
          doc.roundedRect(470, y + 5, 75, 16, 3).fillColor(sColor).fill();
          doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
          doc.text(statusLabels[ctrl.status] || ctrl.status, 470, y + 10, { width: 75, align: 'center' });

          // Checklist summary
          const results = ctrl.checklist_results || [];
          const conformPts = results.filter(r => r.status === 'conform').length;
          doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted);
          doc.text(`${conformPts}/${results.length} points OK`, 50, y + 18);

          y += 35;
        }

        // Device controls table
        if (deviceControls.length > 0) {
          y += 10;
          if (y > 650) { doc.addPage(); drawHeader(); y = 90; }

          doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text).text(`Contrôles des disjoncteurs (${deviceControls.length})`, 50, y);
          y += 18;

          // Table header
          doc.rect(40, y, 515, 20).fillColor(colors.grayLight).fill();
          doc.font('Helvetica-Bold').fontSize(7).fillColor(colors.text);
          doc.text('N°', 45, y + 6, { width: 25 });
          doc.text('Disjoncteur', 75, y + 6, { width: 100 });
          doc.text('Modèle ctrl', 180, y + 6, { width: 80 });
          doc.text('Date', 265, y + 6, { width: 55 });
          doc.text('Contrôleur', 325, y + 6, { width: 80 });
          doc.text('Statut', 410, y + 6, { width: 65 });
          doc.text('Points', 480, y + 6, { width: 70, align: 'center' });
          y += 20;

          for (const dc of deviceControls) {
            if (y > 750) {
              doc.addPage();
              drawHeader();
              y = 90;
              // Re-draw header
              doc.rect(40, y, 515, 20).fillColor(colors.grayLight).fill();
              doc.font('Helvetica-Bold').fontSize(7).fillColor(colors.text);
              doc.text('N°', 45, y + 6, { width: 25 });
              doc.text('Disjoncteur', 75, y + 6, { width: 100 });
              doc.text('Modèle ctrl', 180, y + 6, { width: 80 });
              doc.text('Date', 265, y + 6, { width: 55 });
              doc.text('Contrôleur', 325, y + 6, { width: 80 });
              doc.text('Statut', 410, y + 6, { width: 65 });
              doc.text('Points', 480, y + 6, { width: 70, align: 'center' });
              y += 20;
            }

            const bg = deviceControls.indexOf(dc) % 2 === 0 ? '#ffffff' : '#f9fafb';
            doc.rect(40, y, 515, 16).fillColor(bg).fill();

            doc.font('Helvetica').fontSize(7).fillColor(colors.text);
            doc.text(dc.position_number || '-', 45, y + 4, { width: 25 });
            doc.text((dc.device_name || '-').substring(0, 20), 75, y + 4, { width: 100 });
            doc.text((dc.template_name || '-').substring(0, 16), 180, y + 4, { width: 80 });
            doc.text(new Date(dc.performed_at).toLocaleDateString('fr-FR'), 265, y + 4, { width: 55 });
            doc.text((dc.performed_by || '-').substring(0, 14), 325, y + 4, { width: 80 });

            const dcColor = statusColors[dc.status] || colors.gray;
            doc.roundedRect(410, y + 2, 55, 12, 2).fillColor(dcColor).fill();
            doc.font('Helvetica-Bold').fontSize(5).fillColor('#ffffff');
            doc.text(statusLabels[dc.status] || dc.status, 410, y + 5, { width: 55, align: 'center' });

            const pts = (dc.checklist_results || []).length;
            const okPts = (dc.checklist_results || []).filter(r => r.status === 'conform').length;
            doc.font('Helvetica').fontSize(7).fillColor(colors.textMuted);
            doc.text(`${okPts}/${pts}`, 480, y + 4, { width: 70, align: 'center' });

            y += 16;
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // FOOTER ON ALL PAGES
    // ═══════════════════════════════════════════════════════════════════
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 810, 595, 32).fillColor(colors.grayLight).fill();
      doc.fontSize(7).fillColor(colors.textMuted);
      doc.text(`Rapport de contrôles - ${siteSettings.company_name || site} - Généré le ${new Date().toLocaleDateString('fr-FR')}`, 50, 818, { width: 350 });
      doc.text(`Page ${i + 1} / ${range.count}`, 400, 818, { width: 150, align: 'right' });
    }

    doc.end();

  } catch (e) {
    console.error('[CONTROLS] Bulk PDF report error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// ============================================================
// AUDIT TRAIL - Historique des modifications
// ============================================================

// GET /audit/history - Récupérer l'historique complet
app.get('/api/switchboard/audit/history', async (req, res) => {
  try {
    const site = siteOf(req);
    const { limit = 100, offset = 0, entity_type, entity_id, action } = req.query;

    let query = `
      SELECT id, ts, action, entity_type, entity_id,
             actor_name, actor_email, details
      FROM switchboard_audit_log
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (entity_type) {
      query += ` AND entity_type = $${paramIdx++}`;
      params.push(entity_type);
    }
    if (entity_id) {
      query += ` AND entity_id = $${paramIdx++}`;
      params.push(entity_id);
    }
    if (action) {
      query += ` AND action = $${paramIdx++}`;
      params.push(action);
    }

    query += ` ORDER BY ts DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await quickQuery(query, params);
    res.json({ events: rows });
  } catch (e) {
    console.error('[AUDIT] History error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/entity/:type/:id - Historique d'une entité spécifique
// Pour les switchboards: inclut aussi les événements des devices associés
app.get('/api/switchboard/audit/entity/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit = 100, include_children = 'true' } = req.query;

    let rows;

    // Pour les switchboards, on inclut aussi les événements des devices associés
    if (type === 'switchboard' && include_children === 'true') {
      // Récupérer les IDs des devices de ce switchboard
      const devicesResult = await quickQuery(
        `SELECT id FROM devices WHERE switchboard_id = $1`,
        [parseInt(id)]
      );
      const deviceIds = devicesResult.rows.map(d => d.id.toString());

      if (deviceIds.length > 0) {
        // Requête incluant switchboard ET ses devices
        const result = await quickQuery(`
          SELECT id, ts, action, entity_type, entity_id,
                 actor_name, actor_email, details, old_values, new_values
          FROM switchboard_audit_log
          WHERE (entity_type = 'switchboard' AND entity_id = $1)
             OR (entity_type = 'device' AND entity_id = ANY($2))
          ORDER BY ts DESC
          LIMIT $3
        `, [id, deviceIds, parseInt(limit)]);
        rows = result.rows;
      } else {
        // Pas de devices, requête simple
        const result = await quickQuery(`
          SELECT id, ts, action, entity_type, entity_id,
                 actor_name, actor_email, details, old_values, new_values
          FROM switchboard_audit_log
          WHERE entity_type = $1 AND entity_id = $2
          ORDER BY ts DESC
          LIMIT $3
        `, [type, id, parseInt(limit)]);
        rows = result.rows;
      }
    } else {
      // Requête simple pour les autres types d'entités
      const result = await quickQuery(`
        SELECT id, ts, action, entity_type, entity_id,
               actor_name, actor_email, details, old_values, new_values
        FROM switchboard_audit_log
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY ts DESC
        LIMIT $3
      `, [type, id, parseInt(limit)]);
      rows = result.rows;
    }

    res.json({ events: rows });
  } catch (e) {
    console.error('[AUDIT] Entity history error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/stats - Statistiques d'audit
app.get('/api/switchboard/audit/stats', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const { rows } = await quickQuery(`
      SELECT
        action,
        entity_type,
        COUNT(*) as count,
        COUNT(DISTINCT actor_email) as unique_actors,
        MAX(ts) as last_occurrence
      FROM switchboard_audit_log
      WHERE ts >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY action, entity_type
      ORDER BY count DESC
    `);

    // Activité par jour
    const { rows: daily } = await quickQuery(`
      SELECT
        DATE(ts) as date,
        COUNT(*) as count
      FROM switchboard_audit_log
      WHERE ts >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(ts)
      ORDER BY date DESC
    `);

    // Top contributors
    const { rows: contributors } = await quickQuery(`
      SELECT
        actor_email,
        actor_name,
        COUNT(*) as action_count
      FROM switchboard_audit_log
      WHERE ts >= NOW() - INTERVAL '${parseInt(days)} days'
        AND actor_email IS NOT NULL
      GROUP BY actor_email, actor_name
      ORDER BY action_count DESC
      LIMIT 10
    `);

    res.json({
      by_action: rows,
      by_day: daily,
      top_contributors: contributors
    });
  } catch (e) {
    console.error('[AUDIT] Stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// REPORT PDF - VERSION PROFESSIONNELLE COMPLÈTE
// ============================================================
app.get('/api/switchboard/report', async (req, res) => {
  try {
    const { building, floor, type } = req.query;
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Couleurs professionnelles (électrique/bleu)
    const colors = {
      primary: '#4f46e5',    // Indigo
      secondary: '#1e40af',  // Blue
      success: '#059669',    // Green
      danger: '#dc2626',     // Red
      warning: '#d97706',    // Amber
      text: '#111827',       // Gray-900
      muted: '#6b7280',      // Gray-500
      light: '#f3f4f6',      // Gray-100
    };

    // Build WHERE clause
    const conditions = ['site = $1'];
    const params = [site];
    let paramIdx = 1;

    if (building) { paramIdx++; conditions.push(`building_code = $${paramIdx}`); params.push(building); }
    if (floor) { paramIdx++; conditions.push(`floor = $${paramIdx}`); params.push(floor); }
    if (type) { paramIdx++; conditions.push(`regime_neutral = $${paramIdx}`); params.push(type); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get switchboards with counts
    const { rows: boards } = await pool.query(`
      SELECT s.*,
             (SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id) as device_count,
             (SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id AND d.is_complete = true) as complete_count
      FROM switchboards s
      ${whereClause}
      ORDER BY s.building_code, s.floor, s.code
    `, params);

    // Get all devices for all boards
    const boardIds = boards.map(b => b.id);
    let devicesMap = new Map();
    if (boardIds.length > 0) {
      const { rows: devices } = await pool.query(`
        SELECT id, switchboard_id, name, device_type, manufacturer, reference,
               in_amps, icu_ka, poles, is_differential, is_complete, position_number
        FROM devices
        WHERE switchboard_id = ANY($1)
        ORDER BY position_number, name
      `, [boardIds]);
      devices.forEach(d => {
        if (!devicesMap.has(d.switchboard_id)) devicesMap.set(d.switchboard_id, []);
        devicesMap.get(d.switchboard_id).push(d);
      });
    }

    // Get positions on plans (if switchboard_positions table exists)
    let positionsMap = new Map();
    try {
      const { rows: positions } = await pool.query(`
        SELECT sp.switchboard_id, sp.logical_name, sp.x_frac, sp.y_frac,
               p.thumbnail as plan_thumbnail, COALESCE(pn.display_name, sp.logical_name) as plan_display_name
        FROM switchboard_positions sp
        LEFT JOIN switchboard_plans p ON p.logical_name = sp.logical_name
        LEFT JOIN switchboard_plan_names pn ON pn.logical_name = sp.logical_name
        WHERE sp.switchboard_id = ANY($1)
      `, [boardIds]);
      positions.forEach(p => {
        if (!positionsMap.has(p.switchboard_id)) positionsMap.set(p.switchboard_id, p);
      });
    } catch (e) { /* Table might not exist */ }

    // Get site settings
    let siteInfo = { company_name: site, site_name: site };
    try {
      const { rows } = await pool.query(`SELECT company_name, company_address, company_phone FROM site_settings WHERE site = $1`, [site]);
      if (rows[0]) siteInfo = { ...siteInfo, ...rows[0] };
    } catch (e) { /* ignore */ }

    // Statistics
    const totalDevices = boards.reduce((sum, b) => sum + (Number(b.device_count) || 0), 0);
    const completeDevices = boards.reduce((sum, b) => sum + (Number(b.complete_count) || 0), 0);
    const progressPct = totalDevices > 0 ? Math.round(completeDevices / totalDevices * 100) : 0;
    const principalBoards = boards.filter(b => b.is_principal).length;

    // Group by building
    const byBuilding = {};
    boards.forEach(b => {
      const bldg = b.building_code || 'Non renseigné';
      if (!byBuilding[bldg]) byBuilding[bldg] = [];
      byBuilding[bldg].push(b);
    });

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: {
      Title: 'Rapport Tableaux Électriques',
      Author: siteInfo.company_name,
      Subject: 'Inventaire des tableaux électriques et disjoncteurs'
    }});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rapport_Tableaux_${site.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // ========== PAGE DE GARDE ==========
    doc.rect(0, 0, 595, 842).fill('#eef2ff');
    doc.rect(0, 0, 595, 120).fill(colors.primary);

    doc.fontSize(28).font('Helvetica-Bold').fillColor('#fff')
       .text('Rapport Tableaux Electriques', 50, 40, { width: 495, align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#fff')
       .text('Inventaire & Controle des installations', 50, 80, { width: 495, align: 'center' });

    doc.fontSize(22).font('Helvetica-Bold').fillColor(colors.primary)
       .text(siteInfo.company_name || 'Entreprise', 50, 160, { align: 'center', width: 495 });
    doc.fontSize(14).font('Helvetica').fillColor(colors.text)
       .text(`Site: ${site}`, 50, 195, { align: 'center', width: 495 });

    // Filters
    let filterText = '';
    if (building) filterText += `Batiment: ${building}  `;
    if (floor) filterText += `Etage: ${floor}  `;
    if (type) filterText += `Regime: ${type}`;
    if (filterText) {
      doc.fontSize(10).fillColor(colors.muted).text(`Filtres: ${filterText}`, 50, 220, { align: 'center', width: 495 });
    }

    doc.fontSize(10).fillColor(colors.muted)
       .text(`Document genere le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, 245, { align: 'center', width: 495 });

    // Stats box
    const statsY = 300;
    doc.rect(100, statsY, 395, 200).fillAndStroke('#fff', colors.primary);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary)
       .text('Synthese', 120, statsY + 15, { width: 355, align: 'center' });

    const statsItems = [
      { label: 'Tableaux electriques', value: boards.length, color: colors.primary },
      { label: 'Tableaux principaux', value: principalBoards, color: colors.secondary },
      { label: 'Disjoncteurs total', value: totalDevices, color: colors.text },
      { label: 'Disjoncteurs completes', value: completeDevices, color: colors.success },
      { label: 'Progression globale', value: `${progressPct}%`, color: progressPct >= 80 ? colors.success : (progressPct >= 50 ? colors.warning : colors.danger) },
    ];

    let statY = statsY + 50;
    statsItems.forEach(item => {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(item.label, 130, statY);
      doc.font('Helvetica-Bold').fillColor(item.color).text(String(item.value), 400, statY, { width: 70, align: 'right' });
      statY += 28;
    });

    // ========== SOMMAIRE ==========
    doc.addPage();
    doc.fontSize(24).font('Helvetica-Bold').fillColor(colors.primary).text('Sommaire', 50, 50);
    doc.moveTo(50, 85).lineTo(545, 85).strokeColor(colors.primary).lineWidth(2).stroke();

    const sommaire = [
      { num: '1', title: 'Cadre reglementaire (Suisse)' },
      { num: '2', title: 'Presentation de l\'etablissement' },
      { num: '3', title: 'Inventaire par batiment' },
      { num: '4', title: 'Etat de progression' },
      { num: '5', title: 'Fiches tableaux et disjoncteurs' },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.text).text(item.num, 50, somY);
      doc.font('Helvetica').text(item.title, 80, somY);
      somY += 30;
    });

    // ========== 1. CADRE RÉGLEMENTAIRE ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('1. Cadre reglementaire (Suisse)', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let regY = 100;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(colors.text).text('NIBT - Norme sur les Installations a Basse Tension', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('La NIBT (SN 411000) definit les regles de conception, realisation et verification des installations electriques a basse tension en Suisse.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('OIBT - Ordonnance sur les Installations electriques a Basse Tension', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('L\'OIBT (RS 734.27) regit les conditions de mise en service et de controle periodique des installations electriques.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('Controles periodiques obligatoires', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('Les installations electriques doivent faire l\'objet de controles periodiques selon leur categorie (1 a 20 ans selon le type d\'installation).', 50, regY, { width: 495 });
    regY += 50;

    doc.rect(50, regY, 495, 60).fillAndStroke('#fef3c7', colors.warning);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.warning).text('/!\\ IMPORTANT', 70, regY + 12);
    doc.font('Helvetica').fillColor(colors.text).text('Chaque tableau doit disposer d\'un schema unifilaire a jour et les disjoncteurs doivent etre correctement dimensionnes.', 70, regY + 30, { width: 455 });

    // ========== 2. PRÉSENTATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('2. Presentation de l\'etablissement', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let presY = 100;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary).text(siteInfo.company_name || 'Entreprise', 50, presY);
    presY += 25;
    if (siteInfo.company_address) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Adresse: ${siteInfo.company_address}`, 50, presY);
      presY += 18;
    }
    doc.text(`Site: ${site}`, 50, presY);
    presY += 40;

    doc.fontSize(12).font('Helvetica-Bold').text('Synthese de l\'installation', 50, presY);
    presY += 25;

    [['Tableaux electriques', boards.length], ['Batiments', Object.keys(byBuilding).length], ['Disjoncteurs', totalDevices]].forEach(([label, value]) => {
      doc.rect(50, presY, 240, 35).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(10).font('Helvetica').fillColor(colors.muted).text(label, 60, presY + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(colors.primary).text(String(value), 220, presY + 8, { align: 'right', width: 50 });
      presY += 40;
    });

    // ========== 3. INVENTAIRE PAR BÂTIMENT ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('3. Inventaire par batiment', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    const invHeaders = ['Code', 'Nom', 'Etage', 'Local', 'Disj.', 'Progr.'];
    const invColW = [70, 150, 60, 80, 50, 60];

    Object.entries(byBuilding).forEach(([bldg, bldgBoards]) => {
      if (invY > 700) { doc.addPage(); invY = 50; }

      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.primary).text(`Batiment: ${bldg}`, 50, invY);
      invY += 25;

      // Header row
      let x = 50;
      invHeaders.forEach((h, i) => {
        doc.rect(x, invY, invColW[i], 20).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff').text(h, x + 3, invY + 6, { width: invColW[i] - 6 });
        x += invColW[i];
      });
      invY += 20;

      bldgBoards.forEach((board, idx) => {
        if (invY > 750) { doc.addPage(); invY = 50; }
        const progress = board.device_count > 0 ? Math.round((board.complete_count / board.device_count) * 100) : 0;
        const row = [board.code || '-', (board.name || '-').substring(0, 28), board.floor || '-', (board.room || '-').substring(0, 14), board.device_count || 0, `${progress}%`];

        x = 50;
        const bgColor = idx % 2 === 0 ? '#fff' : colors.light;
        row.forEach((cell, i) => {
          doc.rect(x, invY, invColW[i], 18).fillAndStroke(bgColor, '#e5e7eb');
          let txtColor = colors.text;
          if (i === 5) txtColor = progress >= 80 ? colors.success : (progress >= 50 ? colors.warning : colors.danger);
          doc.fontSize(7).font('Helvetica').fillColor(txtColor).text(String(cell), x + 3, invY + 5, { width: invColW[i] - 6 });
          x += invColW[i];
        });
        invY += 18;
      });
      invY += 15;
    });

    // ========== 4. ÉTAT DE PROGRESSION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('4. Etat de progression', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let progY = 100;
    const progStats = [
      { label: 'Disjoncteurs completes', count: completeDevices, pct: progressPct, color: colors.success },
      { label: 'Disjoncteurs a completer', count: totalDevices - completeDevices, pct: 100 - progressPct, color: colors.warning },
    ];

    progStats.forEach(stat => {
      doc.rect(50, progY, 495, 40).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).font('Helvetica-Bold').fillColor(stat.color).text(stat.label, 60, progY + 8);
      doc.fontSize(9).font('Helvetica').fillColor(colors.muted).text(`${stat.count} disjoncteur(s)`, 60, progY + 23);
      doc.rect(300, progY + 15, 180, 12).fillAndStroke(colors.light, '#d1d5db');
      if (stat.pct > 0) doc.rect(300, progY + 15, Math.max(5, 180 * stat.pct / 100), 12).fill(stat.color);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(stat.color).text(`${stat.pct}%`, 490, progY + 13, { align: 'right', width: 40 });
      progY += 50;
    });

    // ========== 5. FICHES TABLEAUX ==========
    if (boards.length > 0) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('5. Fiches tableaux et disjoncteurs', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted).text(`${boards.length} tableau(x) electrique(s)`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < boards.length; i++) {
        const board = boards[i];
        const devices = devicesMap.get(board.id) || [];
        const progress = board.device_count > 0 ? Math.round((board.complete_count / board.device_count) * 100) : 0;

        // Calculate height needed
        const deviceRows = Math.ceil(devices.length / 1); // one device per row in table
        const cardHeight = 180 + Math.min(devices.length, 8) * 16;

        if (ficheY + cardHeight > 750) {
          doc.addPage();
          ficheY = 50;
        }

        // Card border
        doc.rect(50, ficheY, 495, cardHeight).stroke(colors.light);

        // Header with code
        doc.rect(50, ficheY, 495, 30).fill(colors.primary);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#fff')
           .text(`${board.code} - ${board.name || 'Sans nom'}`, 60, ficheY + 9, { width: 380 });

        // Progress badge
        const progColor = progress >= 80 ? colors.success : (progress >= 50 ? colors.warning : colors.danger);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(progColor === colors.success ? '#fff' : progColor)
           .text(`${progress}%`, 480, ficheY + 10, { width: 50, align: 'right' });

        let infoY = ficheY + 40;
        const leftCol = 60;
        const rightCol = 300;

        // Left column - Info
        doc.fontSize(9).font('Helvetica-Bold').fillColor(colors.text).text('Batiment:', leftCol, infoY);
        doc.font('Helvetica').fillColor(colors.muted).text(board.building_code || '-', leftCol + 60, infoY);
        infoY += 16;

        doc.font('Helvetica-Bold').fillColor(colors.text).text('Etage:', leftCol, infoY);
        doc.font('Helvetica').fillColor(colors.muted).text(board.floor || '-', leftCol + 60, infoY);
        infoY += 16;

        doc.font('Helvetica-Bold').fillColor(colors.text).text('Local:', leftCol, infoY);
        doc.font('Helvetica').fillColor(colors.muted).text(board.room || '-', leftCol + 60, infoY);
        infoY += 16;

        doc.font('Helvetica-Bold').fillColor(colors.text).text('Regime:', leftCol, infoY);
        doc.font('Helvetica').fillColor(colors.muted).text(board.regime_neutral || '-', leftCol + 60, infoY);
        infoY += 16;

        doc.font('Helvetica-Bold').fillColor(colors.text).text('Principal:', leftCol, infoY);
        doc.font('Helvetica').fillColor(board.is_principal ? colors.success : colors.muted).text(board.is_principal ? 'Oui' : 'Non', leftCol + 60, infoY);
        infoY += 16;

        doc.font('Helvetica-Bold').fillColor(colors.text).text('Disjoncteurs:', leftCol, infoY);
        doc.font('Helvetica').fillColor(colors.muted).text(`${board.complete_count || 0} / ${board.device_count || 0} complets`, leftCol + 60, infoY);

        // Right column - Photo placeholder
        const photoX = rightCol + 50;
        const photoY = ficheY + 40;
        if (board.photo && board.photo.length > 0) {
          try {
            doc.image(board.photo, photoX, photoY, { fit: [100, 80] });
            doc.rect(photoX, photoY, 100, 80).stroke('#e5e7eb');
          } catch (e) {
            doc.rect(photoX, photoY, 100, 80).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', photoX + 30, photoY + 35);
          }
        } else {
          doc.rect(photoX, photoY, 100, 80).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', photoX + 25, photoY + 35);
        }

        // Devices table
        if (devices.length > 0) {
          let devY = ficheY + 135;
          doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.primary).text('Disjoncteurs:', leftCol, devY);
          devY += 18;

          const devHeaders = ['Pos.', 'Nom', 'Type', 'In (A)', 'Icu', 'Diff.', 'OK'];
          const devColW = [35, 140, 100, 45, 40, 35, 30];
          let dx = leftCol;
          devHeaders.forEach((h, hi) => {
            doc.rect(dx, devY, devColW[hi], 14).fillAndStroke(colors.light, '#e5e7eb');
            doc.fontSize(6).font('Helvetica-Bold').fillColor(colors.text).text(h, dx + 2, devY + 4, { width: devColW[hi] - 4 });
            dx += devColW[hi];
          });
          devY += 14;

          devices.slice(0, 8).forEach((dev, di) => {
            dx = leftCol;
            const devRow = [
              dev.position_number || '-',
              (dev.name || '-').substring(0, 28),
              (dev.device_type || '-').substring(0, 18),
              dev.in_amps || '-',
              dev.icu_ka ? `${dev.icu_ka}kA` : '-',
              dev.is_differential ? 'Oui' : '-',
              dev.is_complete ? 'OK' : '-'
            ];
            const rowBg = di % 2 === 0 ? '#fff' : colors.light;
            devRow.forEach((cell, ci) => {
              doc.rect(dx, devY, devColW[ci], 12).fillAndStroke(rowBg, '#e5e7eb');
              let cellColor = colors.text;
              if (ci === 6) cellColor = dev.is_complete ? colors.success : colors.muted;
              doc.fontSize(6).font('Helvetica').fillColor(cellColor).text(String(cell), dx + 2, devY + 3, { width: devColW[ci] - 4 });
              dx += devColW[ci];
            });
            devY += 12;
          });

          if (devices.length > 8) {
            doc.fontSize(7).fillColor(colors.muted).text(`... et ${devices.length - 8} autres disjoncteurs`, leftCol, devY + 2);
          }
        }

        ficheY += cardHeight + 15;
      }
    }

    // ========== PAGINATION ==========
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Rapport Tableaux Electriques - ${site} - Page ${i + 1}/${range.count}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[SWITCHBOARD] Generated professional report: ${boards.length} boards, ${totalDevices} devices`);

  } catch (e) {
    console.error('[SWITCHBOARD] Report error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// EQUIPMENT LINKS API - Liens entre équipements
// ============================================================

// Get all links for an equipment (manual links + hierarchical for switchboards)
app.get('/api/equipment/links/:type/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    const { type, id } = req.params;
    console.log('[EQUIPMENT_LINKS] Get links - site:', site, 'type:', type, 'id:', id);

    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const links = [];

    // 1. Get manual links (both directions)
    console.log('[EQUIPMENT_LINKS] Fetching manual links for', type, id);
    const manualLinks = await quickQuery(`
      SELECT * FROM equipment_links
      WHERE site = $1 AND (
        (source_type = $2 AND source_id = $3) OR
        (target_type = $2 AND target_id = $3)
      )
    `, [site, type, String(id)]);
    console.log('[EQUIPMENT_LINKS] Found', manualLinks.rows.length, 'manual links');

    for (const link of manualLinks.rows) {
      const isSource = link.source_type === type && link.source_id === String(id);
      const linkedType = isSource ? link.target_type : link.source_type;
      const linkedId = isSource ? link.target_id : link.source_id;
      console.log('[EQUIPMENT_LINKS] Processing manual link:', link.id, '->', linkedType, linkedId);

      // Get equipment details and position
      const equipmentInfo = await getEquipmentInfo(linkedType, linkedId, site);
      console.log('[EQUIPMENT_LINKS] Equipment info:', equipmentInfo);

      // Flip relationship when we're the target (not source) to maintain consistent perspective
      let relationship = link.link_label || 'connected';
      if (!isSource) {
        if (relationship === 'upstream') relationship = 'downstream';
        else if (relationship === 'downstream') relationship = 'upstream';
        else if (relationship === 'feeds') relationship = 'fed_by';
        else if (relationship === 'fed_by') relationship = 'feeds';
      }

      links.push({
        id: link.id,
        type: 'manual',
        relationship: relationship,
        originalLabel: link.link_label || 'connected',
        isSource: isSource,
        description: link.description,
        linkedEquipment: {
          type: linkedType,
          id: linkedId,
          equipment_type: linkedType,
          equipment_id: linkedId,
          ...equipmentInfo
        }
      });
    }

    // 2. For switchboards: add hierarchical links (devices with downstream_switchboard_id)
    if (type === 'switchboard') {
      console.log('[EQUIPMENT_LINKS] Fetching hierarchical links for switchboard', id);

      // Devices that feed INTO this switchboard (upstream)
      const upstreamDevices = await quickQuery(`
        SELECT d.*, s.code as source_switchboard_code, s.name as source_switchboard_name
        FROM devices d
        JOIN switchboards s ON d.switchboard_id = s.id
        WHERE d.downstream_switchboard_id = $1
      `, [id]);
      console.log('[EQUIPMENT_LINKS] Found', upstreamDevices.rows.length, 'upstream devices (feeding INTO this switchboard)');

      for (const device of upstreamDevices.rows) {
        console.log('[EQUIPMENT_LINKS] Upstream device:', device.name || device.position_number, 'from switchboard', device.source_switchboard_code);
        const sbPosition = await getEquipmentPosition('switchboard', device.switchboard_id, site);
        links.push({
          type: 'hierarchical',
          relationship: 'fed_by',
          linkedEquipment: {
            type: 'switchboard',
            equipment_type: 'switchboard',
            id: device.switchboard_id,
            equipment_id: device.switchboard_id,
            name: device.source_switchboard_name,
            code: device.source_switchboard_code,
            device_name: device.name || `Disj. ${device.position_number}`,
            device_id: device.id,
            ...sbPosition
          }
        });
      }

      // Switchboards that this one feeds (downstream)
      const downstreamSwitchboards = await quickQuery(`
        SELECT d.*, ds.id as downstream_id, ds.code as downstream_code, ds.name as downstream_name
        FROM devices d
        JOIN switchboards ds ON d.downstream_switchboard_id = ds.id
        WHERE d.switchboard_id = $1 AND d.downstream_switchboard_id IS NOT NULL
      `, [id]);
      console.log('[EQUIPMENT_LINKS] Found', downstreamSwitchboards.rows.length, 'downstream switchboards (that this one feeds)');

      for (const device of downstreamSwitchboards.rows) {
        console.log('[EQUIPMENT_LINKS] Downstream switchboard:', device.downstream_code, 'via device', device.name || device.position_number);
        const sbPosition = await getEquipmentPosition('switchboard', device.downstream_id, site);
        links.push({
          type: 'hierarchical',
          relationship: 'feeds',
          linkedEquipment: {
            type: 'switchboard',
            equipment_type: 'switchboard',
            id: device.downstream_id,
            equipment_id: device.downstream_id,
            name: device.downstream_name,
            code: device.downstream_code,
            via_device: device.name || `Disj. ${device.position_number}`,
            device_id: device.id,
            ...sbPosition
          }
        });
      }
    }

    console.log('[EQUIPMENT_LINKS] Returning', links.length, 'total links');
    res.json({ links });
  } catch (e) {
    console.error('[EQUIPMENT_LINKS] Get links error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Helper: Get equipment info by type and id
async function getEquipmentInfo(type, id, site) {
  // ACCURATE schema based on actual CREATE TABLE statements
  const tableMap = {
    switchboard: { table: 'switchboards', nameCol: 'name', codeCol: 'code', hasBuilding: false, hasBuildingCode: true },
    vsd: { table: 'vsd_equipments', nameCol: 'name', codeCol: 'tag', hasBuilding: true, hasBuildingCode: false },
    meca: { table: 'meca_equipments', nameCol: 'name', codeCol: 'tag', hasBuilding: true, hasBuildingCode: false },
    mobile: { table: 'me_equipments', nameCol: 'name', codeCol: 'code', hasBuilding: true, hasBuildingCode: false },
    hv: { table: 'hv_equipments', nameCol: 'name', codeCol: 'code', hasBuilding: false, hasBuildingCode: true },
    glo: { table: 'glo_equipments', nameCol: 'name', codeCol: 'tag', hasBuilding: true, hasBuildingCode: false },
    datahub: { table: 'dh_items', nameCol: 'name', codeCol: 'code', hasBuilding: true, hasBuildingCode: false }
  };

  const config = tableMap[type];
  if (!config) return { name: `Unknown (${type})` };

  try {
    // Build SELECT based on available columns
    const selectCols = [`${config.nameCol} as name`, `${config.codeCol} as code`];
    if (config.hasBuilding) selectCols.push('building');
    if (config.hasBuildingCode) selectCols.push('building_code');

    const result = await quickQuery(
      `SELECT ${selectCols.join(', ')} FROM ${config.table} WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return { name: `Not found (${type} #${id})` };

    const row = result.rows[0];
    const position = await getEquipmentPosition(type, id, site);

    return {
      name: row.name,
      code: row.code,
      building: row.building || row.building_code || '',
      ...position
    };
  } catch (e) {
    console.error(`[EQUIPMENT_LINKS] getEquipmentInfo error for ${type} #${id}:`, e.message);
    return { name: `Error (${type} #${id})` };
  }
}

// Helper: Get equipment position on map
async function getEquipmentPosition(type, id, site) {
  // NOTE: All tables use 'logical_name' except me_equipment_positions which uses 'plan_logical_name'
  const positionTableMap = {
    switchboard: { table: 'switchboard_positions', idCol: 'switchboard_id', planCol: 'logical_name' },
    vsd: { table: 'vsd_positions', idCol: 'equipment_id', planCol: 'logical_name' },
    meca: { table: 'meca_positions', idCol: 'equipment_id', planCol: 'logical_name' },
    mobile: { table: 'me_equipment_positions', idCol: 'equipment_id', planCol: 'plan_logical_name' },
    hv: { table: 'hv_positions', idCol: 'equipment_id', planCol: 'logical_name' },
    glo: { table: 'glo_positions', idCol: 'equipment_id', planCol: 'logical_name' },
    datahub: { table: 'dh_positions', idCol: 'item_id', planCol: 'logical_name' }
  };

  const config = positionTableMap[type];
  if (!config) {
    console.log(`[EQUIPMENT_LINKS] getEquipmentPosition: unknown type ${type}`);
    return { hasPosition: false };
  }

  try {
    const query = `SELECT ${config.planCol} as plan_key, page_index, x_frac, y_frac
       FROM ${config.table} WHERE ${config.idCol} = $1 LIMIT 1`;
    console.log(`[EQUIPMENT_LINKS] getEquipmentPosition query for ${type}:`, query, [id]);

    const result = await quickQuery(query, [id]);
    console.log(`[EQUIPMENT_LINKS] getEquipmentPosition result:`, result.rows);

    if (result.rows.length === 0) {
      console.log(`[EQUIPMENT_LINKS] getEquipmentPosition: no position found for ${type} #${id}`);
      return { hasPosition: false };
    }

    const pos = result.rows[0];
    const positionData = {
      hasPosition: true,
      plan_key: pos.plan_key,
      plan: pos.plan_key, // Alias for compatibility
      page_index: pos.page_index || 0,
      pageIndex: pos.page_index || 0, // Alias for compatibility
      x_frac: pos.x_frac,
      y_frac: pos.y_frac
    };
    console.log(`[EQUIPMENT_LINKS] getEquipmentPosition returning:`, positionData);
    return positionData;
  } catch (e) {
    console.error(`[EQUIPMENT_LINKS] getEquipmentPosition error for ${type} #${id}:`, e.message);
    return { hasPosition: false };
  }
}

// Create a new equipment link
app.post('/api/equipment/links', async (req, res) => {
  try {
    const site = siteOf(req);
    console.log('[EQUIPMENT_LINKS] Create link request - site:', site, 'body:', req.body);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { source_type, source_id, target_type, target_id, link_label, description } = req.body;
    const created_by = req.headers['x-user-email'] || 'unknown';

    if (!source_type || !source_id || !target_type || !target_id) {
      console.error('[EQUIPMENT_LINKS] Create failed - missing fields:', { source_type, source_id, target_type, target_id });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Don't allow linking to self
    if (source_type === target_type && source_id === target_id) {
      console.error('[EQUIPMENT_LINKS] Create failed - self-link attempt');
      return res.status(400).json({ error: 'Cannot link equipment to itself' });
    }

    console.log('[EQUIPMENT_LINKS] Creating link:', source_type, source_id, '->', target_type, target_id);
    const result = await quickQuery(`
      INSERT INTO equipment_links (site, source_type, source_id, target_type, target_id, link_label, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (site, source_type, source_id, target_type, target_id) DO NOTHING
      RETURNING *
    `, [site, source_type, String(source_id), target_type, String(target_id), link_label || 'connected', description, created_by]);

    if (result.rows.length === 0) {
      console.log('[EQUIPMENT_LINKS] Link already exists');
      return res.status(409).json({ error: 'Link already exists' });
    }

    console.log(`[EQUIPMENT_LINKS] Created link #${result.rows[0].id}: ${source_type}#${source_id} → ${target_type}#${target_id}`);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[EQUIPMENT_LINKS] Create link error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// Delete an equipment link
app.delete('/api/equipment/links/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { id } = req.params;

    const result = await quickQuery(`
      DELETE FROM equipment_links WHERE id = $1 AND site = $2 RETURNING *
    `, [id, site]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    console.log(`[EQUIPMENT_LINKS] Deleted link: ${id}`);
    res.json({ ok: true, deleted: result.rows[0] });
  } catch (e) {
    console.error('[EQUIPMENT_LINKS] Delete link error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🧹 Cleanup orphaned equipment links (links pointing to deleted equipment)
app.post('/api/equipment/links/cleanup-orphans', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    console.log(`[EQUIPMENT_LINKS] Cleaning up orphaned links for site: ${site}`);

    // Delete links where the source or target equipment no longer exists
    const result = await quickQuery(`
      DELETE FROM equipment_links el
      WHERE site = $1
      AND (
        -- Source equipment doesn't exist
        (source_type = 'switchboard' AND NOT EXISTS (SELECT 1 FROM switchboards WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'hv' AND NOT EXISTS (SELECT 1 FROM hv_equipments WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'glo' AND NOT EXISTS (SELECT 1 FROM glo_equipments WHERE id = el.source_id))
        OR (source_type = 'vsd' AND NOT EXISTS (SELECT 1 FROM vsd_equipments WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'meca' AND NOT EXISTS (SELECT 1 FROM meca_equipments WHERE id::text = el.source_id))
        OR (source_type = 'mobile_equipment' AND NOT EXISTS (SELECT 1 FROM me_equipments WHERE id = el.source_id))
        -- Target equipment doesn't exist
        OR (target_type = 'switchboard' AND NOT EXISTS (SELECT 1 FROM switchboards WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'hv' AND NOT EXISTS (SELECT 1 FROM hv_equipments WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'glo' AND NOT EXISTS (SELECT 1 FROM glo_equipments WHERE id = el.target_id))
        OR (target_type = 'vsd' AND NOT EXISTS (SELECT 1 FROM vsd_equipments WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'meca' AND NOT EXISTS (SELECT 1 FROM meca_equipments WHERE id::text = el.target_id))
        OR (target_type = 'mobile_equipment' AND NOT EXISTS (SELECT 1 FROM me_equipments WHERE id = el.target_id))
      )
      RETURNING *
    `, [site]);

    console.log(`[EQUIPMENT_LINKS] Cleaned up ${result.rowCount} orphaned links`);
    res.json({ ok: true, deletedCount: result.rowCount, deleted: result.rows });
  } catch (e) {
    console.error('[EQUIPMENT_LINKS] Cleanup orphans error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Search equipment for linking (returns all types)
app.get('/api/equipment/search', async (req, res) => {
  try {
    const site = siteOf(req);
    console.log('[EQUIPMENT_LINKS] Search request - site:', site, 'query:', req.query);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const { q, exclude_type, exclude_id } = req.query;
    const searchTerm = `%${(q || '').toLowerCase()}%`;
    const results = [];

    console.log('[EQUIPMENT_LINKS] Searching for:', q, '-> term:', searchTerm);

    // Search in each equipment table - ACCURATE schema based on actual CREATE TABLE statements:
    // - switchboards: site YES, building NO, building_code YES
    // - vsd_equipments: site YES, building YES, building_code NO
    // - meca_equipments: site NO, building YES, building_code NO
    // - me_equipments: site NO, building YES, building_code NO
    // - hv_equipments: site YES, building NO, building_code YES
    // - glo_equipments: site NO, building YES, building_code NO
    // - dh_items: site NO, building YES, building_code NO
    const searches = [
      { type: 'switchboard', table: 'switchboards', nameCol: 'name', codeCol: 'code', idCol: 'id', hasSite: true, hasBuilding: false, hasBuildingCode: true },
      { type: 'vsd', table: 'vsd_equipments', nameCol: 'name', codeCol: 'tag', idCol: 'id', hasSite: true, hasBuilding: true, hasBuildingCode: false },
      { type: 'meca', table: 'meca_equipments', nameCol: 'name', codeCol: 'tag', idCol: 'id', hasSite: false, hasBuilding: true, hasBuildingCode: false },
      { type: 'mobile', table: 'me_equipments', nameCol: 'name', codeCol: 'code', idCol: 'id', hasSite: false, hasBuilding: true, hasBuildingCode: false },
      { type: 'hv', table: 'hv_equipments', nameCol: 'name', codeCol: 'code', idCol: 'id', hasSite: true, hasBuilding: false, hasBuildingCode: true },
      { type: 'glo', table: 'glo_equipments', nameCol: 'name', codeCol: 'tag', idCol: 'id', hasSite: false, hasBuilding: true, hasBuildingCode: false },
      { type: 'datahub', table: 'dh_items', nameCol: 'name', codeCol: 'code', idCol: 'id', hasSite: false, hasBuilding: true, hasBuildingCode: false }
    ];

    for (const s of searches) {
      try {
        // Build SELECT columns based on what exists
        const selectCols = [`${s.idCol} as id`, `${s.nameCol} as name`, `${s.codeCol} as code`];
        if (s.hasBuilding) selectCols.push('building');
        if (s.hasBuildingCode) selectCols.push('building_code');

        // Build WHERE conditions for building search
        const buildingConditions = [];
        if (s.hasBuilding) buildingConditions.push(`LOWER(COALESCE(building, '')) LIKE $${s.hasSite ? '2' : '1'}`);
        if (s.hasBuildingCode) buildingConditions.push(`LOWER(COALESCE(building_code, '')) LIKE $${s.hasSite ? '2' : '1'}`);
        const buildingWhere = buildingConditions.length > 0 ? buildingConditions.join(' OR ') : 'FALSE';

        // Build query based on whether table has site column
        let query, params;
        if (s.hasSite) {
          query = `
            SELECT ${selectCols.join(', ')}, '${s.type}' as equipment_type
            FROM ${s.table}
            WHERE site = $1 AND (
              LOWER(COALESCE(${s.nameCol}, '')) LIKE $2 OR
              LOWER(COALESCE(${s.codeCol}, '')) LIKE $2 OR
              ${buildingWhere}
            )
            LIMIT 10
          `;
          params = [site, searchTerm];
        } else {
          // Tables without site column - search all records
          query = `
            SELECT ${selectCols.join(', ')}, '${s.type}' as equipment_type
            FROM ${s.table}
            WHERE (
              LOWER(COALESCE(${s.nameCol}, '')) LIKE $1 OR
              LOWER(COALESCE(${s.codeCol}, '')) LIKE $1 OR
              ${buildingWhere}
            )
            LIMIT 10
          `;
          params = [searchTerm];
        }

        console.log('[EQUIPMENT_LINKS] Searching', s.type, '- hasSite:', s.hasSite);
        const result = await quickQuery(query, params);
        console.log('[EQUIPMENT_LINKS]', s.type, 'found', result.rows.length, 'results');

        for (const row of result.rows) {
          // Exclude the source equipment from results
          if (exclude_type === row.equipment_type && String(exclude_id) === String(row.id)) {
            console.log('[EQUIPMENT_LINKS] Excluding self:', row.equipment_type, row.id);
            continue;
          }

          results.push({
            type: row.equipment_type,
            id: row.id,
            name: row.name,
            code: row.code,
            building: row.building || row.building_code,
            label: `${row.code || row.name} (${row.equipment_type})`
          });
        }
      } catch (e) {
        // Log the error - table might not exist or have different schema
        console.error('[EQUIPMENT_LINKS] Search error for', s.type, ':', e.message);
      }
    }

    // Sort by relevance (exact matches first)
    results.sort((a, b) => {
      const aExact = a.code?.toLowerCase() === q?.toLowerCase() || a.name?.toLowerCase() === q?.toLowerCase();
      const bExact = b.code?.toLowerCase() === q?.toLowerCase() || b.name?.toLowerCase() === q?.toLowerCase();
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return 0;
    });

    console.log('[EQUIPMENT_LINKS] Total results:', results.length);
    res.json({ results: results.slice(0, 20) });
  } catch (e) {
    console.error('[EQUIPMENT_LINKS] Search error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// AUTO-CLEANUP ORPHANED DATA
// ============================================================

async function cleanupOrphanedData() {
  console.log('[CLEANUP] Starting automatic cleanup of orphaned data...');

  // Get all sites
  const sitesResult = await quickQuery(`SELECT DISTINCT site FROM switchboards`);
  const sites = sitesResult.rows.map(r => r.site).filter(Boolean);

  let totalPositions = 0;
  let totalLinks = 0;

  for (const site of sites) {
    // 1. Cleanup orphaned switchboard positions (switchboards that no longer exist)
    const posResult = await quickQuery(`
      DELETE FROM switchboard_positions sp
      WHERE site = $1
      AND NOT EXISTS (SELECT 1 FROM switchboards s WHERE s.id = sp.switchboard_id AND s.site = sp.site)
      RETURNING id
    `, [site]);
    totalPositions += posResult.rowCount;

    // 2. Cleanup orphaned equipment links (equipment that no longer exists)
    const linksResult = await quickQuery(`
      DELETE FROM equipment_links el
      WHERE site = $1
      AND (
        -- Source equipment doesn't exist
        (source_type = 'switchboard' AND NOT EXISTS (SELECT 1 FROM switchboards WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'hv' AND NOT EXISTS (SELECT 1 FROM hv_equipments WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'glo' AND NOT EXISTS (SELECT 1 FROM glo_equipments WHERE id = el.source_id))
        OR (source_type = 'vsd' AND NOT EXISTS (SELECT 1 FROM vsd_equipments WHERE id::text = el.source_id AND site = el.site))
        OR (source_type = 'meca' AND NOT EXISTS (SELECT 1 FROM meca_equipments WHERE id::text = el.source_id))
        OR (source_type = 'mobile_equipment' AND NOT EXISTS (SELECT 1 FROM me_equipments WHERE id = el.source_id))
        -- Target equipment doesn't exist
        OR (target_type = 'switchboard' AND NOT EXISTS (SELECT 1 FROM switchboards WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'hv' AND NOT EXISTS (SELECT 1 FROM hv_equipments WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'glo' AND NOT EXISTS (SELECT 1 FROM glo_equipments WHERE id = el.target_id))
        OR (target_type = 'vsd' AND NOT EXISTS (SELECT 1 FROM vsd_equipments WHERE id::text = el.target_id AND site = el.site))
        OR (target_type = 'meca' AND NOT EXISTS (SELECT 1 FROM meca_equipments WHERE id::text = el.target_id))
        OR (target_type = 'mobile_equipment' AND NOT EXISTS (SELECT 1 FROM me_equipments WHERE id = el.target_id))
      )
      RETURNING id
    `, [site]);
    totalLinks += linksResult.rowCount;
  }

  if (totalPositions > 0 || totalLinks > 0) {
    console.log(`[CLEANUP] ✅ Removed ${totalPositions} orphaned positions and ${totalLinks} orphaned equipment links`);
  } else {
    console.log('[CLEANUP] ✅ No orphaned data found');
  }
}

// ============================================================
// START SERVER
// ============================================================

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => {
  console.log(`[SWITCHBOARD] Server v3.0 running on port ${port}`);
  console.log('[SWITCHBOARD] Features: Robust timeouts, Keepalive, Retry, Pool monitoring');

  // ✅ Démarrer le keepalive pour éviter les cold starts Neon
  startKeepalive();

  // ✅ Démarrer le self-ping pour garder le serveur actif pendant les scans
  startSelfPing();

  // ✅ Warm up la connexion DB au démarrage
  pool.query('SELECT 1').then(async () => {
    console.log('[SWITCHBOARD] Database connection warmed up');

    // ✅ Resume any interrupted panel scan jobs after restart
    try {
      await resumePendingJobs();
    } catch (e) {
      console.warn('[SWITCHBOARD] Failed to resume pending jobs:', e.message);
    }

    // 🧹 Auto-cleanup orphaned data on startup (positions and links for deleted equipment)
    try {
      await cleanupOrphanedData();
    } catch (e) {
      console.warn('[SWITCHBOARD] Orphan cleanup failed (non-blocking):', e.message);
    }
  }).catch(e => {
    console.warn('[SWITCHBOARD] Database warmup failed:', e.message);
  });
});
