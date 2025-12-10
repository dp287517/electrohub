// server_switchboard.js - Backend complet Switchboard
// Support XLS/XLSX, cache produits scannés, prompt IA amélioré, détection doublons
// ============ OPTIMIZED VERSION WITH TIMEOUT FIXES ============
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import * as XLSX from 'xlsx'; // SheetJS - supports both .xls and .xlsx

dotenv.config();
const { Pool } = pg;

// ============ OPTIMIZED POOL CONFIGURATION ============
const pool = new Pool({ 
  connectionString: process.env.NEON_DATABASE_URL,
  // Connection pool settings for Neon (serverless)
  max: 10,                      // Max connections in pool
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Timeout for new connections: 10s
});

// Test pool connection on startup
pool.on('error', (err) => {
  console.error('[POOL] Unexpected error on idle client', err);
});

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized');
  } catch (e) {
    console.warn('[SWITCHBOARD] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[SWITCHBOARD] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

const app = express();

// --- CSP CORRIGÉE (POUR LA 3D ET LES WORKERS) ---
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

// Upload setup for photos and Excel files
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

// Health
app.get('/api/switchboard/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['created_at', 'name', 'code', 'building_code', 'floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// ============ QUERY WITH TIMEOUT HELPER ============
async function queryWithTimeout(sql, params, timeoutMs = 10000) {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

// Schema Initialization
async function ensureSchema() {
  await pool.query(`
    -- TABLE: Switchboards
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_switchboards_site ON switchboards(site);
    CREATE INDEX IF NOT EXISTS idx_switchboards_building ON switchboards(building_code);
    CREATE INDEX IF NOT EXISTS idx_switchboards_code ON switchboards(code);

    -- TABLE: Devices
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      downstream_switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE SET NULL,
      name TEXT,
      device_type TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_devices_name ON devices(name);
    CREATE INDEX IF NOT EXISTS idx_devices_position ON devices(position_number);
    CREATE INDEX IF NOT EXISTS idx_devices_complete ON devices(is_complete);
    
    -- ============ CRITICAL: COMPOSITE INDEX FOR FAST COUNTING ============
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard_complete ON devices(switchboard_id, is_complete);

    -- TABLE: Site Settings (Logo, Company Info)
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

    -- TABLE: Scanned Products Cache (for AI learning)
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

    -- Add columns if missing (Migrations)
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

      -- Scanned products unique index (safe creation)
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scanned_products_unique 
        ON scanned_products(site, LOWER(COALESCE(reference, '')), LOWER(COALESCE(manufacturer, '')));
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      
      -- ============ CRITICAL: CREATE COMPOSITE INDEX IF NOT EXISTS ============
      BEGIN
        CREATE INDEX IF NOT EXISTS idx_devices_switchboard_complete ON devices(switchboard_id, is_complete);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END $$;

    -- Add trigger for updated_at
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
  `);
  console.log('[SWITCHBOARD SCHEMA] Initialized successfully');
}
ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA]', e.message));

// Helper: Check if device is complete
function checkDeviceComplete(device) {
  if (!device || typeof device !== 'object') return false;
  return !!(device.manufacturer && device.reference && device.in_amps && Number(device.in_amps) > 0);
}

// ==================== SITE SETTINGS (Logo, Company Info) ====================

app.get('/api/switchboard/settings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(
      `SELECT id, site, company_name, company_address, company_phone, company_email, 
              (logo IS NOT NULL) as has_logo, created_at, updated_at
       FROM site_settings WHERE site = $1`, [site]
    );

    if (!r.rows.length) {
      return res.json({ 
        site, 
        has_logo: false, 
        company_name: null, 
        company_address: null,
        company_phone: null,
        company_email: null
      });
    }

    res.json(r.rows[0]);
  } catch (e) {
    console.error('[SETTINGS GET] error:', e);
    res.status(500).json({ error: 'Get settings failed' });
  }
});

app.put('/api/switchboard/settings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { company_name, company_address, company_phone, company_email } = req.body || {};

    const r = await pool.query(`
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
    console.error('[SETTINGS UPDATE] error:', e);
    res.status(500).json({ error: 'Update settings failed' });
  }
});

app.post('/api/switchboard/settings/logo', upload.single('logo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No logo provided' });

    const mimeType = req.file.mimetype || 'image/png';

    await pool.query(`
      INSERT INTO site_settings (site, logo, logo_mime)
      VALUES ($1, $2, $3)
      ON CONFLICT (site) DO UPDATE SET 
        logo = $2, 
        logo_mime = $3,
        updated_at = NOW()
    `, [site, req.file.buffer, mimeType]);

    res.json({ success: true, message: 'Logo uploaded successfully' });
  } catch (e) {
    console.error('[LOGO UPLOAD] error:', e);
    res.status(500).json({ error: 'Logo upload failed' });
  }
});

app.get('/api/switchboard/settings/logo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(
      `SELECT logo, logo_mime FROM site_settings WHERE site = $1`, [site]
    );

    if (!r.rows.length || !r.rows[0].logo) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    res.set('Content-Type', r.rows[0].logo_mime || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].logo);
  } catch (e) {
    console.error('[LOGO GET] error:', e);
    res.status(500).json({ error: 'Get logo failed' });
  }
});

app.delete('/api/switchboard/settings/logo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    await pool.query(`
      UPDATE site_settings SET logo = NULL, logo_mime = NULL, updated_at = NOW()
      WHERE site = $1
    `, [site]);

    res.json({ success: true });
  } catch (e) {
    console.error('[LOGO DELETE] error:', e);
    res.status(500).json({ error: 'Delete logo failed' });
  }
});

// ==================== PDF EXPORT (BACKEND - LISTING) ====================

app.get('/api/switchboard/boards/:id/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const boardRes = await pool.query(
      `SELECT * FROM switchboards WHERE id = $1 AND site = $2`, [id, site]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });
    const board = boardRes.rows[0];

    const devicesRes = await pool.query(
      `SELECT d.*, sb_down.name as downstream_name, sb_down.code as downstream_code
       FROM devices d
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.switchboard_id = $1 
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`, [id]
    );
    const devices = devicesRes.rows;

    const upstreamRes = await pool.query(
      `SELECT d.*, sb.name as source_board_name, sb.code as source_board_code
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.downstream_switchboard_id = $1`, [id]
    );
    const upstreamDevices = upstreamRes.rows;

    const logoRes = await pool.query(
      `SELECT logo, logo_mime, company_name FROM site_settings WHERE site = $1`, [site]
    );
    const settings = logoRes.rows[0] || {};

    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(board.code || board.name).replace(/[^a-zA-Z0-9-_]/g, '_')}_listing.pdf"`);
    
    doc.pipe(res);

    let headerY = 40;
    let textStartX = 50;

    if (settings.logo) {
      try {
        doc.image(settings.logo, 50, headerY, { width: 70, height: 50 });
        textStartX = 130;
      } catch (logoErr) {
        console.warn('[PDF] Logo render error:', logoErr.message);
      }
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

    doc.fontSize(9).text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, 400, headerY, { align: 'right' });

    if (settings.company_name) {
      doc.fontSize(8).fillColor('#6b7280').text(settings.company_name, 400, headerY + 15, { align: 'right' });
    }

    doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e5e7eb').stroke();

    const summaryY = 125;
    const totalDevices = devices.length;
    const completeDevices = devices.filter(d => d.is_complete).length;
    const differentialDevices = devices.filter(d => d.is_differential).length;
    const mainIncoming = devices.find(d => d.is_main_incoming);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text('Résumé', 50, summaryY);
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    doc.text(`Total disjoncteurs: ${totalDevices}`, 50, summaryY + 15);
    doc.text(`Fiches complètes: ${completeDevices}/${totalDevices} (${totalDevices > 0 ? Math.round(completeDevices/totalDevices*100) : 0}%)`, 180, summaryY + 15);
    doc.text(`Différentiels (DDR): ${differentialDevices}`, 380, summaryY + 15);
    
    if (mainIncoming) {
      doc.text(`Arrivée: ${mainIncoming.manufacturer || ''} ${mainIncoming.reference || ''} ${mainIncoming.in_amps ? mainIncoming.in_amps + 'A' : ''}`, 50, summaryY + 30);
    }

    const tableStartY = summaryY + 55;
    const colWidths = [35, 140, 75, 65, 40, 40, 35, 65];
    const headers = ['N°', 'Désignation', 'Référence', 'Fabricant', 'In', 'Icu', 'P', 'Type/Aval'];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);

    const drawHeader = (y) => {
        doc.rect(50, y, totalWidth, 22).fillColor('#f3f4f6').fill();
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#374151');
        let x = 50;
        headers.forEach((h, i) => {
          doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8 });
          x += colWidths[i];
        });
        doc.rect(50, y, totalWidth, 22).strokeColor('#d1d5db').stroke();
        x = 50;
        colWidths.forEach((w) => {
          x += w;
          if (x < 50 + totalWidth) {
            doc.moveTo(x, y).lineTo(x, y + 22).stroke();
          }
        });
    };

    drawHeader(tableStartY);

    doc.font('Helvetica').fontSize(8);
    let y = tableStartY + 22;
    const rowHeight = 20;
    
    devices.forEach((d, idx) => {
      if (y > 780) {
        doc.addPage();
        y = 50;
        drawHeader(y);
        y += 22;
        doc.font('Helvetica').fontSize(8);
      }

      if (idx % 2 === 1) {
        doc.rect(50, y, totalWidth, rowHeight).fillColor('#fafafa').fill();
      }

      let typeText = '-';
      let typeColor = '#6b7280';
      if (d.downstream_code) {
        typeText = `→ ${d.downstream_code}`;
        typeColor = '#059669';
      } else if (d.is_main_incoming) {
        typeText = 'Arrivée';
        typeColor = '#d97706';
      } else if (d.is_differential) {
        typeText = 'DDR';
        typeColor = '#7c3aed';
      } else if (!d.is_complete) {
        typeText = 'Incomplet';
        typeColor = '#ea580c';
      }

      const row = [
        d.position_number || String(idx + 1),
        (d.name || '-').substring(0, 35),
        (d.reference || '-').substring(0, 18),
        (d.manufacturer || '-').substring(0, 15),
        d.in_amps ? `${d.in_amps}A` : '-',
        d.icu_ka ? `${d.icu_ka}kA` : '-',
        d.poles ? `${d.poles}P` : '-',
        typeText
      ];
      
      let x = 50;
      doc.fillColor('#111827');
      row.forEach((cell, i) => {
        if (i === row.length - 1) {
          doc.fillColor(typeColor);
          if (String(cell).startsWith('→ ')) {
             doc.font('Helvetica-Bold');
          }
        }
        doc.text(String(cell), x + 4, y + 5, { width: colWidths[i] - 8, lineBreak: false, ellipsis: true });
        if (i === row.length - 1) {
          doc.fillColor('#111827');
          doc.font('Helvetica');
        }
        x += colWidths[i];
      });

      doc.rect(50, y, totalWidth, rowHeight).strokeColor('#e5e7eb').stroke();

      x = 50;
      colWidths.forEach((w) => {
        x += w;
        if (x < 50 + totalWidth) {
          doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor('#e5e7eb').stroke();
        }
      });

      y += rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af');
      doc.text(
        `${board.code || board.name} - Page ${i + 1}/${range.count}`,
        50, 820, { align: 'center', width: 495 }
      );
    }

    doc.end();
  } catch (e) {
    console.error('[PDF EXPORT] error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF generation failed', details: e.message });
    }
  }
});

// ==================== SWITCHBOARDS CRUD ====================

app.get('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '100' } = req.query;
    const where = ['site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize, 10) || 100, 500);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    const sql = `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
                        modes, quality, created_at, (photo IS NOT NULL) as has_photo,
                        diagram_data
                 FROM switchboards
                 WHERE ${where.join(' AND ')}
                 ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
                 LIMIT ${limit} OFFSET ${offset}`;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM switchboards WHERE ${where.join(' AND ')}`, vals);
    const data = rows.rows.map(r => ({
      id: r.id,
      meta: { site: r.site, building_code: r.building_code, floor: r.floor, room: r.room },
      name: r.name, code: r.code, regime_neutral: r.regime_neutral,
      is_principal: r.is_principal,
      has_photo: r.has_photo,
      diagram_data: r.diagram_data || {},
      modes: r.modes || {}, quality: r.quality || {}, created_at: r.created_at
    }));
    res.json({ data, total: count.rows[0].total, page: Number(page), pageSize: limit });
  } catch (e) {
    console.error('[SWITCHBOARD LIST] error:', e);
    res.status(500).json({ error: 'List failed' });
  }
});

app.get('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    
    const r = await pool.query(
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
              modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo
       FROM switchboards WHERE id=$1 AND site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];

    const upstream = await pool.query(
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
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal,
      has_photo: sb.has_photo,
      diagram_data: sb.diagram_data || {},
      upstream_sources: upstream.rows,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD GET] error:', e);
    res.status(500).json({ error: 'Get failed' });
  }
});

app.post('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();
    if (!name || !code) return res.status(400).json({ error: 'Missing name/code' });
    const building = b?.meta?.building_code || null;
    const floor = b?.meta?.floor || null;
    const room = b?.meta?.room || null;
    const regime = b?.regime_neutral || null;
    const is_principal = !!b?.is_principal;
    const modes = b?.modes || {};
    const quality = b?.quality || {};
    const diagram_data = b?.diagram_data || {};

    const r = await pool.query(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, created_at`,
      [site, name, code, building, floor, room, regime, is_principal, modes, quality, diagram_data]
    );
    const sb = r.rows[0];
    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD CREATE] error:', e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// ============ UPDATE SWITCHBOARD - WITH BODY VALIDATION ============
app.put('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body;
    
    // ============ VALIDATION DU BODY ============
    if (!b || typeof b !== 'object' || Object.keys(b).length === 0) {
      console.warn('[SWITCHBOARD UPDATE] Empty body received for id:', id);
      return res.status(400).json({ error: 'Request body is empty or invalid' });
    }
    
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();
    if (!name || !code) return res.status(400).json({ error: 'Missing name/code' });
    const building = b?.meta?.building_code || null;
    const floor = b?.meta?.floor || null;
    const room = b?.meta?.room || null;
    const regime = b?.regime_neutral || null;
    const is_principal = !!b?.is_principal;
    const modes = b?.modes || {};
    const quality = b?.quality || {};
    const diagram_data = b?.diagram_data || {};

    const r = await pool.query(
      `UPDATE switchboards SET
        name=$1, code=$2, building_code=$3, floor=$4, room=$5, regime_neutral=$6, is_principal=$7, modes=$8, quality=$9, diagram_data=$12
       WHERE id=$10 AND site=$11
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo`,
      [name, code, building, floor, room, regime, is_principal, modes, quality, id, site, diagram_data]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: sb.has_photo,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD UPDATE] error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM devices WHERE switchboard_id = $1`, [id]
    );
    const deviceCount = countResult.rows[0]?.count || 0;
    
    const r = await pool.query(`DELETE FROM switchboards WHERE id=$1 AND site=$2 RETURNING id, name`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true, deleted: id, name: r.rows[0].name, devices_deleted: deviceCount });
  } catch (e) {
    console.error('[SWITCHBOARD DELETE] error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.post('/api/switchboard/boards/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data)
       SELECT site, name || ' (copy)', code || '_COPY', building_code, floor, room, regime_neutral, FALSE, modes, quality, diagram_data
       FROM switchboards WHERE id=$1 AND site=$2
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, diagram_data, created_at`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      modes: sb.modes || {}, quality: sb.quality || {}, diagram_data: sb.diagram_data, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD DUPLICATE] error:', e);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// ==================== SWITCHBOARD PHOTO ====================

app.post('/api/switchboard/boards/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const r = await pool.query(
      `UPDATE switchboards SET photo = $1 WHERE id = $2 AND site = $3 RETURNING id`,
      [req.file.buffer, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true, id });
  } catch (e) {
    console.error('[SWITCHBOARD PHOTO UPLOAD] error:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/switchboard/boards/:id/photo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `SELECT photo FROM switchboards WHERE id = $1 AND site = $2`, [id, site]
    );
    if (!r.rows.length || !r.rows[0].photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].photo);
  } catch (e) {
    console.error('[SWITCHBOARD PHOTO GET] error:', e);
    res.status(500).json({ error: 'Get photo failed' });
  }
});

// ==================== DEVICE COUNTS - OPTIMIZED WITH TIMEOUT ====================

app.post('/api/switchboard/devices-count', async (req, res) => {
  const startTime = Date.now();
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const boardIds = req.body?.board_ids;
    
    // ============ FAST PATH: Si pas d'IDs, retourner vide immédiatement ============
    if (!boardIds || !Array.isArray(boardIds) || boardIds.length === 0) {
      return res.json({ counts: {} });
    }

    const ids = boardIds.map(Number).filter(Boolean);
    if (!ids.length) return res.json({ counts: {} });

    // ============ OPTIMIZED QUERY - Uses composite index with timeout ============
    const { rows } = await queryWithTimeout(`
      SELECT switchboard_id, 
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_complete = true)::int AS complete
      FROM devices
      WHERE switchboard_id = ANY($1::int[])
      GROUP BY switchboard_id
    `, [ids], 8000); // 8 second timeout
    
    const counts = {};
    rows.forEach(r => {
      counts[r.switchboard_id] = { total: r.total, complete: r.complete };
    });
    
    // Fill in zeros for IDs with no devices
    ids.forEach(id => {
      if (!counts[id]) counts[id] = { total: 0, complete: 0 };
    });
    
    const elapsed = Date.now() - startTime;
    if (elapsed > 2000) {
      console.warn(`[DEVICES COUNT] Slow query: ${elapsed}ms for ${ids.length} boards`);
    }
    
    res.json({ counts });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`[DEVICES COUNT] error after ${elapsed}ms:`, e.message);
    
    // ============ RETURN EMPTY COUNTS ON ERROR - DON'T BLOCK UI ============
    res.json({ counts: {}, error: e.message, partial: true });
  }
});

// ==================== DEVICES CRUD ====================

app.get('/api/switchboard/boards/:boardId/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.params.boardId);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
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
      [switchboard_id]
    );
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICES LIST] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

app.get('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `SELECT d.*, s.name as switchboard_name,
              sb_down.name as downstream_switchboard_name
       FROM devices d
       JOIN switchboards s ON d.switchboard_id = s.id
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.id = $1 AND s.site = $2`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES GET] error:', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

app.post('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const b = req.body || {};
    const switchboard_id = Number(b.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const is_complete = checkDeviceComplete(b);
    const is_differential = !!b.is_differential;
    const settings = b.settings || {};
    const diagram_data = b.diagram_data || {};

    const { rows } = await pool.query(
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
        is_differential,
        is_complete,
        settings,
        !!b.is_main_incoming,
        diagram_data
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[DEVICES CREATE] error:', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// ============ UPDATE DEVICE - WITH BODY VALIDATION ============
app.put('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body;
    
    // ============ VALIDATION DU BODY ============
    if (!b || typeof b !== 'object' || Object.keys(b).length === 0) {
      console.warn('[DEVICES UPDATE] Empty body received for id:', id);
      return res.status(400).json({ error: 'Request body is empty or invalid' });
    }
    
    const is_complete = checkDeviceComplete(b);
    const is_differential = !!b.is_differential;
    const settings = b.settings || {};
    const diagram_data = b.diagram_data || {};

    const { rows } = await pool.query(
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
        is_differential,
        is_complete,
        settings,
        !!b.is_main_incoming,
        diagram_data,
        id,
        site
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[DEVICES UPDATE] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `DELETE FROM devices d
       USING switchboards sb
       WHERE d.id = $1 AND d.switchboard_id = sb.id AND sb.site = $2
       RETURNING d.id`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DEVICES DELETE] error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ==================== EXCEL IMPORT ====================

app.post('/api/switchboard/import-excel', upload.single('file'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const filename = req.file.originalname || '';
    console.log(`[EXCEL IMPORT] Processing file: ${filename}, size: ${req.file.buffer.length}`);

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { 
        type: 'buffer',
        cellDates: true,
        cellNF: false,
        cellText: false
      });
    } catch (parseErr) {
      console.error('[EXCEL IMPORT] Parse error:', parseErr.message);
      return res.status(400).json({ error: `Format de fichier non supporté ou corrompu: ${parseErr.message}` });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'No worksheet found' });
    
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    if (!data || data.length < 12) {
      return res.status(400).json({ error: 'Fichier Excel trop court (moins de 12 lignes)' });
    }

    const getCellValue = (rowIndex, colIndex) => {
      if (!data[rowIndex]) return '';
      const val = data[rowIndex][colIndex];
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      return String(val).trim();
    };

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

    console.log(`[EXCEL IMPORT] Extracted: name="${tableauName}", code="${code}", building=${building}, floor=${floor}`);

    const existingBoard = await pool.query(
      `SELECT id, name, code FROM switchboards WHERE site = $1 AND LOWER(code) = LOWER($2)`,
      [site, code]
    );

    let switchboardId;
    let boardAlreadyExists = false;
    let existingDeviceCount = 0;

    if (existingBoard.rows.length > 0) {
      boardAlreadyExists = true;
      switchboardId = existingBoard.rows[0].id;
      
      const countRes = await pool.query(
        `SELECT COUNT(*)::int as count FROM devices WHERE switchboard_id = $1`,
        [switchboardId]
      );
      existingDeviceCount = countRes.rows[0]?.count || 0;
      
      if (existingBoard.rows[0].name !== tableauName) {
        await pool.query(
          `UPDATE switchboards SET name = $1, building_code = $2, floor = $3 WHERE id = $4`,
          [tableauName, building, floor, switchboardId]
        );
      }
      
      console.log(`[EXCEL IMPORT] Board already exists: id=${switchboardId}, existing devices=${existingDeviceCount}`);
    } else {
      const newBoard = await pool.query(
        `INSERT INTO switchboards (site, name, code, building_code, floor, regime_neutral)
         VALUES ($1, $2, $3, $4, $5, 'TN-S')
         RETURNING id`,
        [site, tableauName, code, building, floor]
      );
      switchboardId = newBoard.rows[0].id;
      console.log(`[EXCEL IMPORT] Created new board: id=${switchboardId}`);
    }

    const EXCLUDED_KEYWORDS = [
      'modifié', 'modified', 'date', 'nom', 'name', 'prénom', 'prenom', 'first name',
      'société', 'societe', 'company', 'visa', 'maintenance', 'préventive', 'preventive',
      'copie', 'transmise', 'responsable', 'signature', 'approved', 'checked',
      'revision', 'révision', 'version', 'drawn', 'dessiné', 'vérifié', 'verified',
      'établi', 'etabli', 'contrôlé', 'controle', 'approuvé', 'approuve'
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
      for (const cellVal of cellValues) {
        if (/^(mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim)/i.test(cellVal)) return true;
        if (/^\d{4}-\d{2}-\d{2}/.test(cellVal)) return true;
        if (/^\d{2}[\/.-]\d{2}[\/.-]\d{2,4}$/.test(cellVal)) return true;
      }
      return false;
    };

    let devicesCreated = 0;
    let devicesSkipped = 0;
    const startRow = 11;
    let consecutiveEmptyRows = 0;
    const MAX_EMPTY_ROWS = 3;

    const existingPositions = new Set();
    if (boardAlreadyExists) {
      const posRes = await pool.query(
        `SELECT position_number FROM devices WHERE switchboard_id = $1 AND position_number IS NOT NULL`,
        [switchboardId]
      );
      posRes.rows.forEach(r => existingPositions.add(String(r.position_number).toLowerCase()));
    }

    for (let rowIndex = startRow; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      if (!row) continue;

      const position = getCellValue(rowIndex, 0);
      
      let designation = '';
      for (let col = 1; col <= 4; col++) {
        const val = getCellValue(rowIndex, col);
        if (val && val.length > 1) { designation = val; break; }
      }

      if (position.toLowerCase().includes('repère') || 
          position.toLowerCase().includes('repere') || 
          position.toLowerCase().includes('départ') ||
          position.toLowerCase().includes('depart') ||
          position.toLowerCase().includes('n°')) {
        continue;
      }

      if (!position && !designation) {
        consecutiveEmptyRows++;
        if (consecutiveEmptyRows >= MAX_EMPTY_ROWS) {
          console.log(`[EXCEL IMPORT] Stopping at row ${rowIndex + 1}: ${MAX_EMPTY_ROWS} consecutive empty rows`);
          break;
        }
        continue;
      }
      
      consecutiveEmptyRows = 0;

      if (isMetadataRow(row)) {
        devicesSkipped++;
        continue;
      }

      if (!isValidPosition(position)) {
        devicesSkipped++;
        continue;
      }

      if (!designation) {
        devicesSkipped++;
        continue;
      }

      if (existingPositions.has(String(position).toLowerCase())) {
        devicesSkipped++;
        continue;
      }

      await pool.query(
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
        ? `⚠️ Tableau "${code}" déjà existant. ${devicesCreated} nouveaux départs ajoutés.`
        : `✅ Tableau "${code}" créé avec ${devicesCreated} départs.`
    });
  } catch (e) {
    console.error('[EXCEL IMPORT] error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ==================== AI PHOTO ANALYSIS ====================

app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!openai) return res.status(503).json({ error: 'OpenAI not available' });

    const buffer = req.file.buffer;
    const base64Image = buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en identification de disjoncteurs. Identifie le FABRICANT et la RÉFÉRENCE.

FABRICANTS: Hager (bleu), Schneider (vert), ABB (orange), Legrand (vert), Siemens (turquoise), Eaton (rouge).

Ne retourne JAMAIS null pour manufacturer - fais une supposition basée sur la couleur/style.
Réponds en JSON: {"manufacturer":"...", "manufacturer_confidence":"high/medium/low", "reference":"...", "is_differential":bool, "in_amps":number, "poles":number}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyse ce disjoncteur.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.2
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    let cacheResults = [];
    if (result.reference || result.manufacturer) {
      try {
        const cacheQuery = await pool.query(`
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
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed: ' + e.message });
  }
});

// ==================== AI DEVICE SEARCH ====================

app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    if (!openai) return res.json({ error: 'OpenAI not available' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `Extrait les spécifications d'un disjoncteur. Retourne JSON: {"manufacturer":"...", "reference":"...", "in_amps":number, "icu_ka":number, "poles":number, "voltage_v":number, "is_differential":bool}` 
        },
        { role: 'user', content: `Spécifications: ${query}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== SEARCH HELPERS ====================

app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();

    const where = ['site = $1'];
    const vals = [site];
    if (query) {
      where.push(`(LOWER(name) ILIKE $2 OR LOWER(code) ILIKE $2)`);
      vals.push(`%${query}%`);
    }

    const { rows } = await pool.query(
      `SELECT id, name, code, building_code, floor, room
       FROM switchboards WHERE ${where.join(' AND ')}
       ORDER BY code, name LIMIT 20`, vals
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== STATS ====================

app.get('/api/switchboard/stats', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM switchboards WHERE site = $1) as total_boards,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1) as total_devices,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1 AND d.is_complete = true) as complete_devices,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1 AND d.is_differential = true) as differential_devices
    `, [site]);

    res.json(stats.rows[0]);
  } catch (e) {
    console.error('[STATS] error:', e.message);
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ==================== START SERVER ====================

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`[SWITCHBOARD] Service running on :${port}`));
