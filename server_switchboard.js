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
const GEMINI_MODEL = 'gemini-2.0-flash';

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
    -- Index composite CRITIQUE pour les counts
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard_complete ON devices(switchboard_id, is_complete);

    -- ✅ INDEX ADDITIONNELS v3.0 pour performance
    -- Index pour tri par position_number (très utilisé)
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard_position ON devices(switchboard_id, position_number);
    -- Index partiel pour devices incomplets (requêtes "à compléter")
    CREATE INDEX IF NOT EXISTS idx_devices_incomplete ON devices(switchboard_id) WHERE is_complete = false;
    -- Index pour recherche par site + switchboard (multi-tenant)
    CREATE INDEX IF NOT EXISTS idx_devices_site_switchboard ON devices(site, switchboard_id);

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
    -- TABLE: Switchboard Audit Log (traçabilité des modifications)
    -- =======================================================
    CREATE TABLE IF NOT EXISTS switchboard_audit_log (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      actor_name TEXT,
      actor_email TEXT,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
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
        ALTER TABLE control_schedules ADD COLUMN meca_equipment_id INTEGER;
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
        ALTER TABLE control_records ADD COLUMN meca_equipment_id INTEGER;
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
      -- CONTROL TEMPLATES: Nouveaux target_type
      -- =====================================================
      -- Les target_type supportés sont maintenant: switchboard, device, vsd, meca, mobile_equipment

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
      -- SWITCHBOARD_AUDIT_LOG: Migration colonnes manquantes
      -- =====================================================
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
    -- RECALCULER TOUS LES COUNTS EXISTANTS (migration one-time)
    -- Note: s'exécute à chaque démarrage mais très rapide si déjà correct
    -- =======================================================
    UPDATE switchboards s SET
      device_count = COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id), 0),
      complete_count = COALESCE((SELECT COUNT(*) FROM devices d WHERE d.switchboard_id = s.id AND d.is_complete = true), 0)
    WHERE device_count IS NULL 
       OR complete_count IS NULL
       OR device_count < 0 
       OR complete_count < 0;
  `);
  
  console.log('[SWITCHBOARD SCHEMA] Initialized with O(1) auto-count triggers v2');
}

ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA ERROR]', e.message));

// ============================================================
// AUDIT TRAIL - Traçabilité des modifications
// ============================================================
const audit = createAuditTrail(pool, 'switchboard');
audit.ensureTable().catch(e => console.error('[SWITCHBOARD AUDIT ERROR]', e.message));

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

    // REQUÊTE OPTIMISÉE: inclut device_count et complete_count directement
    const sql = `
      SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
             modes, quality, diagram_data, created_at, 
             (photo IS NOT NULL) as has_photo,
             COALESCE(device_count, 0) as device_count,
             COALESCE(complete_count, 0) as complete_count
      FROM switchboards
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
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
      has_photo: r.has_photo,
      diagram_data: r.diagram_data || {},
      modes: r.modes || {}, 
      quality: r.quality || {}, 
      created_at: r.created_at,
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
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
              modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo,
              COALESCE(device_count, 0) as device_count,
              COALESCE(complete_count, 0) as complete_count
       FROM switchboards WHERE id=$1 AND site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Board not found' });
    const sb = r.rows[0];

    // Get upstream sources (what feeds this board)
    const upstream = await quickQuery(
      `SELECT d.id, d.name, d.position_number, d.in_amps, 
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
      has_photo: sb.has_photo,
      diagram_data: sb.diagram_data || {},
      upstream_sources: upstream.rows,
      modes: sb.modes || {}, 
      quality: sb.quality || {}, 
      created_at: sb.created_at,
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

    const b = req.body || {};
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const r = await quickQuery(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, device_count, complete_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0)
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, created_at, device_count, complete_count`,
      [site, name, code, b?.meta?.building_code || null, b?.meta?.floor || null, b?.meta?.room || null,
       b?.regime_neutral || null, !!b?.is_principal, b?.modes || {}, b?.quality || {}, b?.diagram_data || {}]
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
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data,
      created_at: sb.created_at,
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

    console.log(`[UPDATE BOARD] Starting update for id=${id}, site=${site}`);

    // ✅ quickQuery avec retry intégré (timeout 10s, 1 retry)
    const r = await quickQuery(
      `UPDATE switchboards SET
        name=$1, code=$2, building_code=$3, floor=$4, room=$5,
        regime_neutral=$6, is_principal=$7, modes=$8, quality=$9, diagram_data=$10
      WHERE id=$11 AND site=$12
      RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal,
                modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo,
                device_count, complete_count`,
      [name, code, b?.meta?.building_code || null, b?.meta?.floor || null, b?.meta?.room || null,
       b?.regime_neutral || null, !!b?.is_principal, b?.modes || {}, b?.quality || {}, b?.diagram_data || {},
       id, site],
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
        data: { equipmentType: 'switchboard', equipmentId: sb.id, url: `/app/switchboards/${sb.id}` }
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

    const r = await quickQuery(
      `SELECT d.*, s.name as switchboard_name, s.code as switchboard_code,
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
        position_number, is_differential, is_complete, settings, is_main_incoming, diagram_data
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
        b.position_number || null,
        !!b.is_differential,
        is_complete,
        b.settings || {},
        !!b.is_main_incoming,
        b.diagram_data || {}
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
         diagram_data = $18, updated_at = NOW()
       FROM switchboards sb
       WHERE devices.id = $19 AND devices.switchboard_id = sb.id AND sb.site = $20
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
          console.log('[PHOTO ANALYSIS v2.0] Found validated cache match, using cached values');
          result = {
            ...result,
            in_amps: result.in_amps || validatedMatch.in_amps,
            icu_ka: result.icu_ka || validatedMatch.icu_ka,
            ics_ka: result.ics_ka || validatedMatch.ics_ka,
            poles: result.poles || validatedMatch.poles,
            voltage_v: result.voltage_v || validatedMatch.voltage_v,
            trip_unit: result.trip_unit || validatedMatch.trip_unit,
            from_validated_cache: true
          };
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

// In-memory store for panel scan jobs (could use Redis in production)
const panelScanJobs = new Map();

// Cleanup old jobs after 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of panelScanJobs) {
    if (job.created_at < oneHourAgo) panelScanJobs.delete(id);
  }
}, 300000);

// Background worker function
async function processPanelScan(jobId, images, site, switchboardId, userEmail) {
  const job = panelScanJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'analyzing';
    job.progress = 10;
    job.message = 'Analyse IA en cours...';

    console.log(`[PANEL SCAN] Job ${jobId}: Starting AI analysis...`);

    // Construire le message avec toutes les images
    const imageContents = images.map(img => ({
      type: 'image_url',
      image_url: img
    }));

    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert électricien spécialisé en identification d'appareillage électrique dans les tableaux.

MISSION: Analyser la/les photo(s) d'un tableau électrique et identifier TOUS les appareils modulaires visibles AVEC leurs étiquettes de position.

ÉTIQUETTES DE POSITION - PRIORITÉ ABSOLUE:
- Sur les tableaux, il y a des ÉTIQUETTES au-dessus ou en-dessous de chaque disjoncteur
- Ces étiquettes indiquent la POSITION/NUMÉRO du circuit (ex: "1", "2", "3", "Q1", "Q2", "A1", "B3", etc.)
- Tu DOIS lire et retranscrire ces positions EXACTEMENT dans le champ "position_label"
- Il peut AUSSI y avoir un nom/description du circuit - le mettre dans "circuit_name"
- Si pas d'étiquette de position visible, mettre null
- NE PAS inventer des positions type "R1-P1" - lire les VRAIES étiquettes !

TYPES D'APPAREILS À IDENTIFIER (TOUS sans exception):
- Disjoncteurs (magnéto-thermiques)
- Disjoncteurs différentiels
- Interrupteurs différentiels
- Interrupteurs sectionneurs
- Contacteurs (jour/nuit, heures creuses)
- Télérupteurs
- Relais (temporisés, impulsionnels)
- Minuteries
- Parafoudres
- Horloges/programmateurs
- Délesteurs
- Transformateurs modulaires

POUR CHAQUE APPAREIL, extraire TOUTES ces données:
1. POSITION (étiquette) - Le numéro/code sur l'étiquette (PRIMORDIAL: "1", "Q3", "A2", etc.)
2. Nom du circuit si visible (ex: "Éclairage Cuisine", "VMC", "PAC")
3. Fabricant (Schneider, Hager, Legrand, ABB, Siemens, Merlin Gerin, etc.)
4. Type d'appareil
5. Référence visible sur l'appareil (ex: iC60N, C60N, DX3, etc.)
6. Intensité nominale (In) en ampères
7. Courbe de déclenchement (B, C, D, K, Z) si visible
8. Pouvoir de coupure ultime (Icu) en kA - souvent marqué "6kA", "10kA", "15kA"
9. Pouvoir de coupure en service (Ics) en kA si visible (souvent Ics=Icu ou Ics=75%Icu)
10. Tension assignée (voltage_v): 230V pour mono, 400V pour tri, ou valeur visible
11. Nombre de pôles - CRITIQUE pour distinguer mono/triphasé:
   - 1P = 1 pôle, 1 module de large (18mm), MONOPHASÉ sans neutre coupé, voltage=230V
   - 1P+N ou 2P = 2 pôles, 2 modules de large (36mm), MONOPHASÉ avec neutre, voltage=230V
   - 3P = 3 pôles, 3 modules de large (54mm), TRIPHASÉ sans neutre, voltage=400V
   - 3P+N ou 4P = 4 pôles, 4 modules de large (72mm), TRIPHASÉ avec neutre, voltage=400V
   MÉTHODE: Compte la LARGEUR de l'appareil en modules (1 module = 18mm) ou le nombre de manettes liées ensemble
12. Si différentiel: sensibilité en mA (30, 300, 500) et type (AC, A, B, F, Hpi, Si)

Réponds en JSON:
{
  "panel_description": "Description générale du tableau",
  "total_devices_detected": number,
  "devices": [
    {
      "position_label": "Q3" ou "1" ou "A2" ou null,
      "circuit_name": "Éclairage Cuisine" ou null,
      "row": 1,
      "position_in_row": 3,
      "device_type": "Disjoncteur modulaire",
      "manufacturer": "Schneider Electric",
      "reference": "iC60N" ou null,
      "in_amps": 16,
      "curve_type": "C" ou null,
      "icu_ka": 6 ou null,
      "ics_ka": 6 ou null,
      "voltage_v": 230,
      "poles": 1,  // 1=mono sans N, 2=mono+N (1P+N), 3=tri sans N, 4=tri+N (3P+N)
      "is_differential": false,
      "differential_sensitivity_ma": null,
      "differential_type": null,
      "confidence": "high/medium/low",
      "notes": "observations particulières"
    }
  ],
  "analysis_notes": "observations générales"
}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analyse ${images.length > 1 ? 'ces photos' : 'cette photo'} de tableau électrique.

TRÈS IMPORTANT: Lis les ÉTIQUETTES DE POSITION sur chaque disjoncteur (au-dessus ou en-dessous). Ces étiquettes indiquent le numéro/code du circuit (ex: "1", "2", "Q1", "A3"). Lis aussi le nom du circuit si visible.

Identifie TOUS les appareils modulaires avec leurs positions et caractéristiques techniques.` },
            ...imageContents
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8000,
      temperature: 0.1
    });

    let result = JSON.parse(visionResponse.choices[0].message.content);
    const deviceCount = result.total_devices_detected || result.devices?.length || 0;
    console.log(`[PANEL SCAN] Job ${jobId}: Detected ${deviceCount} devices`);

    // Debug: Log icu_ka values from AI response
    const icuValues = result.devices?.map(d => ({ pos: d.position_label, ref: d.reference, icu: d.icu_ka })) || [];
    console.log(`[PANEL SCAN] Initial icu_ka values:`, JSON.stringify(icuValues));

    job.progress = 50;
    job.message = `${deviceCount} appareils détectés, enrichissement via cache...`;

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
      console.log(`[PANEL SCAN] Found ${cachedProducts.length} cached products for site ${site}`);
    } catch (e) { console.warn('[PANEL SCAN] Cache lookup failed:', e.message); }

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
        console.log(`[PANEL SCAN] Cache hit for ${device.reference}: Icu=${cached.icu_ka}kA`);
        return {
          ...device,
          icu_ka: device.icu_ka || cached.icu_ka,
          ics_ka: device.ics_ka || cached.ics_ka,
          voltage_v: device.voltage_v || cached.voltage_v || 230,
          poles: device.poles || cached.poles,
          curve_type: device.curve_type || cached.curve_type,
          from_cache: true,
          cache_validated: cached.validated,
          selected: true
        };
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

    job.progress = 90;
    job.message = 'Finalisation...';

    // Debug: Log final icu_ka values before setting result
    const finalIcuValues = result.devices?.map(d => ({ pos: d.position_label, ref: d.reference, icu: d.icu_ka, fromCache: d.from_cache, enriched: d.enriched_by_ai })) || [];
    console.log(`[PANEL SCAN] Final icu_ka values:`, JSON.stringify(finalIcuValues));

    // Job complete
    job.status = 'completed';
    job.progress = 100;
    job.message = `${deviceCount} appareils détectés !`;
    job.result = {
      ...result,
      photos_analyzed: images.length,
      analysis_version: '1.0'
    };
    job.completed_at = Date.now();

    console.log(`[PANEL SCAN] Job ${jobId}: Complete with ${deviceCount} devices`);

    // Send push notification
    if (userEmail) {
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
              url: `/app/tableaux`
            }
          }
        );
      } catch (e) {
        console.warn('[PANEL SCAN] Push notification failed:', e.message);
      }
    }

  } catch (error) {
    console.error(`[PANEL SCAN] Job ${jobId} failed:`, error.message);
    job.status = 'failed';
    job.progress = 0;
    job.message = error.message;
    job.error = error.message;
    job.completed_at = Date.now();

    // Notify failure
    if (userEmail) {
      try {
        const { notifyUser } = await import('./lib/push-notify.js');
        await notifyUser(userEmail,
          '❌ Erreur scan tableau',
          `L'analyse a échoué: ${error.message}`,
          { type: 'panel_scan_failed', tag: `panel-scan-${jobId}` }
        );
      } catch (e) { /* ignore */ }
    }
  }
}

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
    panelScanJobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      message: 'En file d\'attente...',
      switchboard_id: switchboard_id,
      photos_count: req.files.length,
      created_at: Date.now(),
      user_email: user.email
    });

    // Return immediately with job ID
    res.json({
      job_id: jobId,
      status: 'pending',
      message: 'Analyse démarrée en arrière-plan',
      poll_url: `/api/switchboard/panel-scan-job/${jobId}`
    });

    // Start processing in background (after response is sent)
    setImmediate(() => {
      processPanelScan(jobId, images, site, switchboard_id, user.email);
    });

  } catch (e) {
    console.error('[PANEL SCAN] Error:', e.message);
    res.status(500).json({ error: 'Panel analysis failed: ' + e.message });
  }
});

// GET /api/switchboard/panel-scan-job/:id - Get job status/result
app.get('/api/switchboard/panel-scan-job/:id', (req, res) => {
  const job = panelScanJobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Job non trouvé' });
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

    // Vérifier que le tableau existe
    const { rows: [board] } = await quickQuery(
      'SELECT id, name FROM switchboards WHERE id = $1 AND site = $2',
      [switchboard_id, site]
    );
    if (!board) return res.status(404).json({ error: 'Tableau non trouvé' });

    // Charger les appareils existants pour ce tableau (pour éviter les doublons)
    const { rows: existingDevices } = await quickQuery(
      'SELECT id, position_number, reference, manufacturer, in_amps FROM devices WHERE switchboard_id = $1 AND site = $2',
      [switchboard_id, site]
    );
    console.log(`[BULK CREATE] Found ${existingDevices.length} existing devices`);

    const createdDevices = [];
    const updatedDevices = [];
    const errors = [];

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      try {
        // Utiliser position_label comme position_number
        const positionNumber = device.position_label || device.position || String(i + 1);

        // Chercher si un appareil existe déjà à cette position ou avec la même référence
        const existingDevice = existingDevices.find(e =>
          e.position_number === positionNumber ||
          (e.reference && device.reference &&
           e.reference.toLowerCase() === device.reference.toLowerCase() &&
           e.in_amps === device.in_amps)
        );

        if (existingDevice) {
          // Mettre à jour l'appareil existant avec les nouvelles infos
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
              settings = jsonb_set(
                COALESCE(settings, '{}'::jsonb),
                '{last_scan}',
                $17::jsonb
              ),
              updated_at = NOW()
            WHERE id = $1 AND site = $2
            RETURNING *
          `, [
            existingDevice.id,
            site,
            device.circuit_name || device.name,
            device.device_type,
            device.manufacturer,
            device.reference,
            device.in_amps,
            device.icu_ka,
            device.ics_ka,
            device.poles,
            device.voltage_v,
            device.is_differential,
            positionNumber,
            device.curve_type,
            device.differential_sensitivity_ma,
            device.differential_type,
            JSON.stringify({
              width_modules: device.width_modules,
              scanned_at: new Date().toISOString(),
              source: 'panel_scan'
            })
          ]);
          console.log(`[BULK CREATE] Updated existing device ${existingDevice.id} at position ${positionNumber}`);
          updatedDevices.push(updated);
        } else {
          // Créer un nouvel appareil
          const { rows: [created] } = await quickQuery(`
            INSERT INTO devices (
              site, switchboard_id, name, device_type, manufacturer, reference,
              in_amps, icu_ka, ics_ka, poles, voltage_v,
              is_differential, position_number, is_complete,
              curve_type, differential_sensitivity_ma, differential_type, settings
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
          `, [
            site,
            switchboard_id,
            device.circuit_name || device.name || `${device.device_type || 'Disjoncteur'} ${positionNumber}`,
            device.device_type || 'Disjoncteur modulaire',
            device.manufacturer,
            device.reference,
            device.in_amps,
            device.icu_ka,
            device.ics_ka,
            device.poles || 1,
            device.voltage_v || 230,
            device.is_differential || false,
            positionNumber,
            false, // is_complete
            device.curve_type || null,
            device.differential_sensitivity_ma || null,
            device.differential_type || null,
            JSON.stringify({
              width_modules: device.width_modules,
              scanned_at: new Date().toISOString(),
              source: 'panel_scan'
            })
          ]);
          console.log(`[BULK CREATE] Created new device at position ${positionNumber}`);
          createdDevices.push(created);
        }

        // Sauvegarder dans le cache des produits scannés si référence complète
        if (device.manufacturer && device.reference && device.in_amps) {
          try {
            const normalizedRef = normalizeRef(device.reference);
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
            `, [site, normalizedRef, device.manufacturer, device.in_amps, device.icu_ka, device.ics_ka, device.poles, device.voltage_v, device.curve_type]);
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
      
      const { rows: devs } = await quickQuery(
        'SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY position_number ASC NULLS LAST', 
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

    const { reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential, settings, photo_base64, source } = req.body;
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
          scan_count = scan_count + 1, validated = true, last_scanned_at = NOW() 
        WHERE id = $11 RETURNING *
      `, [device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential, 
          settings ? JSON.stringify(settings) : null, photo_base64 ? Buffer.from(photo_base64, 'base64') : null, 
          existing.rows[0].id]);
    } else {
      result = await quickQuery(`
        INSERT INTO scanned_products (site, reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential, settings, photo_thumbnail, validated, source, last_scanned_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, NOW()) RETURNING *
      `, [site, normalizedReference, manufacturer, device_type || 'Low Voltage Circuit Breaker', in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit,
          is_differential || false, settings ? JSON.stringify(settings) : '{}',
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
    let sql = `SELECT id, reference, manufacturer, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential, settings, scan_count, validated, last_scanned_at FROM scanned_products WHERE site = $1`;
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
// PDF EXPORT
// ============================================================

app.get('/api/switchboard/boards/:id/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });

    const boardRes = await quickQuery(`SELECT * FROM switchboards WHERE id = $1 AND site = $2`, [id, site]);
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });
    const board = boardRes.rows[0];

    const devicesRes = await quickQuery(
      `SELECT d.*, sb_down.name as downstream_name, sb_down.code as downstream_code
       FROM devices d
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.switchboard_id = $1 
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`, [id]
    );
    const devices = devicesRes.rows;

    const upstreamRes = await quickQuery(
      `SELECT d.*, sb.name as source_board_name, sb.code as source_board_code
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.downstream_switchboard_id = $1`, [id]
    );
    const upstreamDevices = upstreamRes.rows;

    const logoRes = await quickQuery(`SELECT logo, logo_mime, company_name FROM site_settings WHERE site = $1`, [site]);
    const settings = logoRes.rows[0] || {};

    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(board.code || board.name).replace(/[^a-zA-Z0-9-_]/g, '_')}_listing.pdf"`);
    doc.pipe(res);

    // Header
    let headerY = 40, textStartX = 50;
    if (settings.logo) {
      try { doc.image(settings.logo, 50, headerY, { width: 70, height: 50 }); textStartX = 130; } catch (e) {}
    }

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e40af').text(board.name, textStartX, headerY);
    doc.fontSize(10).font('Helvetica').fillColor('#374151');
    doc.text(`Code: ${board.code || '-'}`, textStartX, headerY + 25);
    doc.text(`Bâtiment: ${board.building_code || '-'} | Étage: ${board.floor || '-'} | Local: ${board.room || '-'}`, textStartX, headerY + 40);
    
    let upstreamText = "Source: Inconnue / Principale";
    if (upstreamDevices.length > 0) {
      upstreamText = "Alimenté par: " + upstreamDevices.map(d => `${d.source_board_code} (${d.name})`).join(', ');
    } else if (board.is_principal) {
      upstreamText = "Type: Tableau Principal (TGBT)";
    }
    doc.text(upstreamText, textStartX, headerY + 55);
    doc.fontSize(9).text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 400, headerY, { align: 'right' });
    if (settings.company_name) doc.fontSize(8).fillColor('#6b7280').text(settings.company_name, 400, headerY + 15, { align: 'right' });
    doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e5e7eb').stroke();

    // Summary
    const summaryY = 125;
    const totalDevices = devices.length;
    const completeDevices = devices.filter(d => d.is_complete).length;
    const differentialDevices = devices.filter(d => d.is_differential).length;
    const mainIncoming = devices.find(d => d.is_main_incoming);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text('Résumé', 50, summaryY);
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    doc.text(`Total: ${totalDevices}`, 50, summaryY + 15);
    doc.text(`Complètes: ${completeDevices}/${totalDevices}`, 150, summaryY + 15);
    doc.text(`DDR: ${differentialDevices}`, 300, summaryY + 15);
    if (mainIncoming) doc.text(`Arrivée: ${mainIncoming.manufacturer || ''} ${mainIncoming.in_amps || ''}A`, 50, summaryY + 30);

    // Table
    const tableStartY = summaryY + 55;
    const colWidths = [35, 140, 75, 65, 40, 40, 35, 65];
    const headers = ['N°', 'Désignation', 'Référence', 'Fabricant', 'In', 'Icu', 'P', 'Type'];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);

    const drawHeader = (y) => {
      doc.rect(50, y, totalWidth, 22).fillColor('#f3f4f6').fill();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#374151');
      let x = 50;
      headers.forEach((h, i) => { doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8 }); x += colWidths[i]; });
      doc.rect(50, y, totalWidth, 22).strokeColor('#d1d5db').stroke();
    };

    drawHeader(tableStartY);
    doc.font('Helvetica').fontSize(8);
    let y = tableStartY + 22;
    const rowHeight = 20;
    
    devices.forEach((d, idx) => {
      if (y > 780) { doc.addPage(); y = 50; drawHeader(y); y += 22; doc.font('Helvetica').fontSize(8); }
      if (idx % 2 === 1) doc.rect(50, y, totalWidth, rowHeight).fillColor('#fafafa').fill();

      let typeText = '-', typeColor = '#6b7280';
      if (d.downstream_code) { typeText = `→ ${d.downstream_code}`; typeColor = '#059669'; }
      else if (d.is_main_incoming) { typeText = 'Arrivée'; typeColor = '#d97706'; }
      else if (d.is_differential) { typeText = 'DDR'; typeColor = '#7c3aed'; }
      else if (!d.is_complete) { typeText = 'Incomplet'; typeColor = '#ea580c'; }

      const row = [
        d.position_number || String(idx + 1), (d.name || '-').substring(0, 35),
        (d.reference || '-').substring(0, 18), (d.manufacturer || '-').substring(0, 15),
        d.in_amps ? `${d.in_amps}A` : '-', d.icu_ka ? `${d.icu_ka}kA` : '-',
        d.poles ? `${d.poles}P` : '-', typeText
      ];
      
      let x = 50;
      doc.fillColor('#111827');
      row.forEach((cell, i) => {
        if (i === row.length - 1) doc.fillColor(typeColor);
        doc.text(String(cell), x + 4, y + 5, { width: colWidths[i] - 8, lineBreak: false, ellipsis: true });
        if (i === row.length - 1) doc.fillColor('#111827');
        x += colWidths[i];
      });
      doc.rect(50, y, totalWidth, rowHeight).strokeColor('#e5e7eb').stroke();
      y += rowHeight;
    });

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af').text(`${board.code || board.name} - Page ${i + 1}/${range.count}`, 50, 820, { align: 'center', width: 495 });
    }
    doc.end();
  } catch (e) {
    console.error('[PDF EXPORT]', e.message);
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

    const { name, description, target_type, frequency_months, checklist_items } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const createdBy = req.headers['x-user-email'] || req.headers['x-user-name'] || 'unknown';

    const { rows } = await quickQuery(`
      INSERT INTO control_templates (site, name, description, target_type, frequency_months, checklist_items, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [site, name, description || null, target_type || 'switchboard', frequency_months || 12,
        JSON.stringify(checklist_items || []), createdBy]);

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
    const { name, description, target_type, frequency_months, checklist_items, is_active } = req.body;

    const { rows } = await quickQuery(`
      UPDATE control_templates
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          target_type = COALESCE($3, target_type),
          frequency_months = COALESCE($4, frequency_months),
          checklist_items = COALESCE($5, checklist_items),
          is_active = COALESCE($6, is_active),
          updated_at = NOW()
      WHERE id = $7 AND site = $8
      RETURNING *
    `, [name, description, target_type, frequency_months,
        checklist_items ? JSON.stringify(checklist_items) : null, is_active, id, site]);

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
             d.name as device_name, d.position_number as device_position,
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
             d.name as device_name, d.position_number as device_position,
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
            checklist_results, global_notes, signature_base64, status } = req.body;

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
    if (switchboard_id) controlUrl = `/app/switchboards/${switchboard_id}`;
    else if (device_id) controlUrl = `/app/switchboard/device/${device_id}`;
    else if (vsd_equipment_id) controlUrl = `/app/vsd/equipment/${vsd_equipment_id}`;
    else if (meca_equipment_id) controlUrl = `/app/meca/equipment/${meca_equipment_id}`;
    else if (mobile_equipment_id) controlUrl = `/app/mobile-equipment/${mobile_equipment_id}`;
    else if (hv_equipment_id) controlUrl = `/app/hv/equipment/${hv_equipment_id}`;
    else if (glo_equipment_id) controlUrl = `/app/glo/equipment/${glo_equipment_id}`;
    else if (datahub_equipment_id) controlUrl = `/app/datahub/equipment/${datahub_equipment_id}`;

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

// --- DASHBOARD / STATS ---

// Get control status summary
app.get('/api/switchboard/controls/dashboard', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    // Pending controls
    const pending = await quickQuery(`
      SELECT COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date >= CURRENT_DATE AND status != 'done'
    `, [site]);

    // Overdue controls
    const overdue = await quickQuery(`
      SELECT COUNT(*) as count FROM control_schedules
      WHERE site = $1 AND next_due_date < CURRENT_DATE AND status != 'done'
    `, [site]);

    // Recent completions (last 30 days)
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
             d.position_number, d.name as device_name,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards sb ON cs.switchboard_id = sb.id
      LEFT JOIN devices d ON cs.device_id = d.id
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
             d.position_number, d.name as device_name,
             vsd.name as vsd_name, vsd.tag as vsd_code, vsd.building as vsd_building,
             meca.name as meca_name, meca.tag as meca_code, meca.building as meca_building,
             me.name as mobile_equipment_name, me.code as mobile_equipment_code, me.building as mobile_equipment_building,
             glo.name as glo_equipment_name, glo.tag as glo_equipment_code, glo.building as glo_equipment_building
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards sb ON cs.switchboard_id = sb.id
      LEFT JOIN devices d ON cs.device_id = d.id
      LEFT JOIN vsd_equipments vsd ON cs.vsd_equipment_id::text = vsd.id::text
      LEFT JOIN meca_equipments meca ON cs.meca_equipment_id::text = meca.id::text
      LEFT JOIN me_equipments me ON cs.mobile_equipment_id::text = me.id::text
      LEFT JOIN glo_equipments glo ON cs.glo_equipment_id::text = glo.id::text
      WHERE cs.site = $1 AND cs.next_due_date < CURRENT_DATE
      ORDER BY cs.next_due_date ASC
      LIMIT 20
    `, [site]);

    res.json({
      stats: {
        pending: Number(pending.rows[0]?.count || 0),
        overdue: Number(overdue.rows[0]?.count || 0),
        completed_30d: Number(recent.rows[0]?.count || 0),
        templates: Number(templates.rows[0]?.count || 0)
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
    if (!type || type === 'meca' || type === 'all') {
      try {
        const mecaRes = await quickQuery(`
          SELECT e.id, e.name, e.building, e.floor, e.location, e.serial_number, e.manufacturer
          FROM meca_equipments e
          INNER JOIN sites s ON s.id = e.site_id
          WHERE s.name = $1 ORDER BY e.name
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
        ORDER BY position_number::int NULLS LAST, name
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
app.get('/api/switchboard/audit/entity/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit = 50 } = req.query;

    const { rows } = await quickQuery(`
      SELECT id, ts, action, entity_type, entity_id,
             actor_name, actor_email, details, old_values, new_values
      FROM switchboard_audit_log
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY ts DESC
      LIMIT $3
    `, [type, id, parseInt(limit)]);

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
// START SERVER
// ============================================================

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => {
  console.log(`[SWITCHBOARD] Server v3.0 running on port ${port}`);
  console.log('[SWITCHBOARD] Features: Robust timeouts, Keepalive, Retry, Pool monitoring');

  // ✅ Démarrer le keepalive pour éviter les cold starts Neon
  startKeepalive();

  // ✅ Warm up la connexion DB au démarrage
  pool.query('SELECT 1').then(() => {
    console.log('[SWITCHBOARD] Database connection warmed up');
  }).catch(e => {
    console.warn('[SWITCHBOARD] Database warmup failed:', e.message);
  });
});
