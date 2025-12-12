// server_switchboard.js - Backend complet Switchboard
// VERSION 3.0 - ROBUSTE TIMEOUTS & PERFORMANCE
// =======================================================
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

dotenv.config();
const { Pool } = pg;

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
// OPENAI SETUP
// ============================================================
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized');
  } catch (e) {
    console.warn('[SWITCHBOARD] OpenAI init failed:', e.message);
  }
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
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
      source TEXT DEFAULT 'photo_scan'
    );
    
    CREATE INDEX IF NOT EXISTS idx_scanned_products_site ON scanned_products(site);
    CREATE INDEX IF NOT EXISTS idx_scanned_products_reference ON scanned_products(reference);
    CREATE INDEX IF NOT EXISTS idx_scanned_products_manufacturer ON scanned_products(manufacturer);

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

    const elapsed = Date.now() - startTime;
    console.log(`[UPDATE BOARD] Completed in ${elapsed}ms for id=${id}`);

    const sb = r.rows[0];
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
    
    // Get device count before delete (for response)
    const countRes = await quickQuery(`SELECT device_count FROM switchboards WHERE id = $1 AND site = $2`, [id, site]);
    const deviceCount = countRes.rows[0]?.device_count || 0;
    
    const r = await quickQuery(`DELETE FROM switchboards WHERE id=$1 AND site=$2 RETURNING id, name`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Board not found' });
    
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
    
    // Le trigger met à jour automatiquement device_count et complete_count
    
    res.status(201).json(rows[0]);
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

    const elapsed = Date.now() - startTime;
    console.log(`[UPDATE DEVICE] Completed in ${elapsed}ms for id=${id}`);

    res.json(rows[0]);
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

    const r = await quickQuery(
      `DELETE FROM devices d
       USING switchboards sb
       WHERE d.id = $1 AND d.switchboard_id = sb.id AND sb.site = $2
       RETURNING d.id, d.switchboard_id`,
      [id, site]
    );
    
    if (r.rowCount === 0) return res.status(404).json({ error: 'Device not found' });
    
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
// AI PHOTO ANALYSIS
// ============================================================

app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!openai) return res.status(503).json({ error: 'OpenAI not available' });

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en identification de disjoncteurs électriques.
FABRICANTS CONNUS: Hager (bleu), Schneider (vert), ABB (orange), Legrand (vert foncé), Siemens (turquoise), Eaton (rouge).
NE RETOURNE JAMAIS null pour manufacturer - fais une supposition basée sur la couleur/style si nécessaire.
Réponds uniquement en JSON: {"manufacturer":"...", "manufacturer_confidence":"high/medium/low", "reference":"...", "is_differential":bool, "in_amps":number, "poles":number, "manufacturer_clues":"..."}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identifie ce disjoncteur.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.2
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Check cache for similar products
    let cacheResults = [];
    if (result.reference || result.manufacturer) {
      try {
        const cacheQuery = await quickQuery(`
          SELECT id, reference, manufacturer, in_amps, icu_ka, poles, is_differential, scan_count, validated
          FROM scanned_products
          WHERE site = $1 AND (reference ILIKE $2 OR manufacturer ILIKE $3)
          ORDER BY validated DESC, scan_count DESC LIMIT 5
        `, [site, `%${result.reference || ''}%`, `%${result.manufacturer || ''}%`]);
        cacheResults = cacheQuery.rows;
      } catch (e) { /* ignore */ }
    }
    
    res.json({ ...result, cache_suggestions: cacheResults, from_cache: false });
  } catch (e) {
    console.error('[PHOTO ANALYSIS]', e.message);
    res.status(500).json({ error: 'Photo analysis failed: ' + e.message });
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
    
    // Check if exists
    const existing = await quickQuery(`
      SELECT id, scan_count FROM scanned_products 
      WHERE site = $1 AND LOWER(reference) = LOWER($2) AND LOWER(COALESCE(manufacturer, '')) = LOWER(COALESCE($3, ''))
    `, [site, reference, manufacturer || '']);
    
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
      `, [site, reference, manufacturer, device_type || 'Low Voltage Circuit Breaker', in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, 
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
