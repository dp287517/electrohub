// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import ExcelJS from 'exceljs';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

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
app.use(helmet());
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
      diagram_data JSONB DEFAULT '{}'::jsonb, -- Pour le schéma unifilaire (position X/Y, style)
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
      diagram_data JSONB DEFAULT '{}'::jsonb, -- Pour le schéma unifilaire
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
}
ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA]', e.message));

// Helper: Check if device is complete
function checkDeviceComplete(device) {
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

// ==================== PDF EXPORT (CORRECTED) ====================

app.get('/api/switchboard/boards/:id/pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    // Get board info
    const boardRes = await pool.query(
      `SELECT * FROM switchboards WHERE id = $1 AND site = $2`, [id, site]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });
    const board = boardRes.rows[0];

    // Get devices with downstream info
    const devicesRes = await pool.query(
      `SELECT d.*, sb_down.name as downstream_name, sb_down.code as downstream_code
       FROM devices d
       LEFT JOIN switchboards sb_down ON d.downstream_switchboard_id = sb_down.id
       WHERE d.switchboard_id = $1 
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`, [id]
    );
    const devices = devicesRes.rows;

    // Get upstream info (Sources)
    const upstreamRes = await pool.query(
      `SELECT d.*, sb.name as source_board_name, sb.code as source_board_code
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.downstream_switchboard_id = $1`, [id]
    );
    const upstreamDevices = upstreamRes.rows;

    // Get logo if exists
    const logoRes = await pool.query(
      `SELECT logo, logo_mime, company_name FROM site_settings WHERE site = $1`, [site]
    );
    const settings = logoRes.rows[0] || {};

    // Create PDF with bufferPages to fix Footer issue
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(board.code || board.name).replace(/[^a-zA-Z0-9-_]/g, '_')}_listing.pdf"`);
    
    doc.pipe(res);

    // ===== HEADER =====
    let headerY = 40;
    let textStartX = 50;

    // Logo (top-left)
    if (settings.logo) {
      try {
        doc.image(settings.logo, 50, headerY, { width: 70, height: 50 });
        textStartX = 130;
      } catch (logoErr) {
        console.warn('[PDF] Logo render error:', logoErr.message);
      }
    }

    // Title and info
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e40af').text(board.name, textStartX, headerY);
    doc.fontSize(10).font('Helvetica').fillColor('#374151');
    doc.text(`Code: ${board.code || '-'}`, textStartX, headerY + 25);
    doc.text(`Bâtiment: ${board.building_code || '-'} | Étage: ${board.floor || '-'} | Local: ${board.room || '-'}`, textStartX, headerY + 40);
    
    // Upstream info in header if available
    let upstreamText = "Source: Inconnue / Principale";
    if (upstreamDevices.length > 0) {
      upstreamText = "Alimenté par: " + upstreamDevices.map(d => `${d.source_board_name} (${d.name})`).join(', ');
    } else if (board.is_principal) {
      upstreamText = "Type: Tableau Principal (TGBT)";
    }
    doc.text(upstreamText, textStartX, headerY + 55);

    // Date on the right
    doc.fontSize(9).text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, 400, headerY, { align: 'right' });

    // Company name if available
    if (settings.company_name) {
      doc.fontSize(8).fillColor('#6b7280').text(settings.company_name, 400, headerY + 15, { align: 'right' });
    }

    // Separator line
    doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e5e7eb').stroke();

    // ===== SUMMARY =====
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

    // ===== TABLE =====
    const tableStartY = summaryY + 55;
    const colWidths = [35, 140, 75, 65, 40, 40, 35, 65];
    const headers = ['N°', 'Désignation', 'Référence', 'Fabricant', 'In', 'Icu', 'P', 'Type/Aval'];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);

    // Helper to draw header
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

    // Table rows
    doc.font('Helvetica').fontSize(8);
    let y = tableStartY + 22;
    const rowHeight = 20;
    
    devices.forEach((d, idx) => {
      // Check if we need a new page
      if (y > 780) {
        doc.addPage();
        y = 50;
        drawHeader(y);
        y += 22;
        doc.font('Helvetica').fontSize(8);
      }

      // Alternate row background
      if (idx % 2 === 1) {
        doc.rect(50, y, totalWidth, rowHeight).fillColor('#fafafa').fill();
      }

      // Determine type badge or downstream info
      let typeText = '-';
      let typeColor = '#6b7280';
      if (d.downstream_name) {
        typeText = `Vers ${d.downstream_name}`;
        typeColor = '#059669'; // Green for link
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

      // Row data
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
          if (String(cell).startsWith('Vers ')) {
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

      // Row border
      doc.rect(50, y, totalWidth, rowHeight).strokeColor('#e5e7eb').stroke();

      // Vertical lines
      x = 50;
      colWidths.forEach((w) => {
        x += w;
        if (x < 50 + totalWidth) {
          doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor('#e5e7eb').stroke();
        }
      });

      y += rowHeight;
    });

    // ===== FOOTER (Now safe due to bufferPages: true) =====
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

// LIST Switchboards
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

// GET ONE Switchboard (INCLUDES UPSTREAM INFO)
app.get('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    
    // Board details
    const r = await pool.query(
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
              modes, quality, diagram_data, created_at, (photo IS NOT NULL) as has_photo
       FROM switchboards WHERE id=$1 AND site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];

    // GET UPSTREAM: Find devices in OTHER boards that point to THIS board
    // This solves the "Double Feeding" visibility
    const upstream = await pool.query(
      `SELECT d.id, d.name, d.position_number, d.in_amps, 
              s.id as source_board_id, s.name as source_board_name, s.code as source_board_code
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
      upstream_sources: upstream.rows, // Array of devices feeding this board
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD GET] error:', e);
    res.status(500).json({ error: 'Get failed' });
  }
});

// CREATE Switchboard
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

// UPDATE Switchboard
app.put('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
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

// DELETE Switchboard
app.delete('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    
    // Count devices
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

// DUPLICATE Switchboard
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

// ==================== DEVICE COUNTS ====================

app.post('/api/switchboard/devices-count', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const boardIds = req.body?.board_ids || [];
    
    if (!boardIds.length) {
      const { rows } = await pool.query(
        `SELECT d.switchboard_id, 
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE d.is_complete = true)::int AS complete
         FROM devices d 
         JOIN switchboards sb ON d.switchboard_id = sb.id
         WHERE sb.site = $1 
         GROUP BY d.switchboard_id`, [site]
      );
      const counts = {};
      rows.forEach(r => {
        counts[r.switchboard_id] = { total: r.total, complete: r.complete };
      });
      return res.json({ counts });
    }

    const ids = boardIds.map(Number).filter(Boolean);
    if (!ids.length) return res.json({ counts: {} });

    const { rows } = await pool.query(
      `SELECT switchboard_id, 
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_complete = true)::int AS complete
       FROM devices
       WHERE switchboard_id = ANY($1::int[])
       GROUP BY switchboard_id`, [ids]
    );
    
    const counts = {};
    rows.forEach(r => {
      counts[r.switchboard_id] = { total: r.total, complete: r.complete };
    });
    
    ids.forEach(id => {
      if (!counts[id]) counts[id] = { total: 0, complete: 0 };
    });
    
    res.json({ counts });
  } catch (e) {
    console.error('[DEVICES COUNT] error:', e.message);
    res.status(500).json({ error: 'Count failed' });
  }
});

// ==================== DEVICES CRUD ====================

// LIST Devices for a switchboard (INCLUDES DOWNSTREAM NAMES)
app.get('/api/switchboard/boards/:boardId/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.params.boardId);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    // Join with downstream switchboard to get its name
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

// GET ONE Device
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

// CREATE Device
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

// UPDATE Device
app.put('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body || {};
    
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

// DELETE Device
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

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'No worksheet found' });

    // Extract basic info
    let tableauName = 'Tableau importé';
    let code = `IMP-${Date.now()}`;
    const row2 = sheet.getRow(2);
    for (let col = 4; col <= 7; col++) {
      const val = row2.getCell(col).value;
      if (val) { tableauName = String(val).trim(); break; }
    }
    const row4 = sheet.getRow(4);
    for (let col = 4; col <= 7; col++) {
      const val = row4.getCell(col).value;
      if (val) { code = String(val).trim(); break; }
    }

    const codeParts = code.split('-');
    const building = codeParts[0] || null;
    const floor = codeParts[1] || null;

    let switchboardId;
    const existingBoard = await pool.query(
      `SELECT id FROM switchboards WHERE site = $1 AND code = $2`,
      [site, code]
    );

    if (existingBoard.rows.length > 0) {
      switchboardId = existingBoard.rows[0].id;
      await pool.query(
        `UPDATE switchboards SET name = $1, building_code = $2, floor = $3 WHERE id = $4`,
        [tableauName, building, floor, switchboardId]
      );
    } else {
      const newBoard = await pool.query(
        `INSERT INTO switchboards (site, name, code, building_code, floor, regime_neutral)
         VALUES ($1, $2, $3, $4, $5, 'TN-S')
         RETURNING id`,
        [site, tableauName, code, building, floor]
      );
      switchboardId = newBoard.rows[0].id;
    }

    let devicesCreated = 0;
    const startRow = 12;

    for (let rowNum = startRow; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const positionCell = row.getCell(1).value;
      const position = positionCell ? String(positionCell).trim() : '';
      
      if (!position || position.toLowerCase().includes('repère') || position.toLowerCase().includes('départ')) continue;

      let designation = '';
      for (let col = 2; col <= 5; col++) {
        const val = row.getCell(col).value;
        if (val) { designation = String(val).trim(); break; }
      }

      if (!designation) continue;

      await pool.query(
        `INSERT INTO devices (site, switchboard_id, name, device_type, position_number, is_differential, is_complete)
         VALUES ($1, $2, $3, $4, $5, false, false)`,
        [site, switchboardId, designation, 'Low Voltage Circuit Breaker', position]
      );
      devicesCreated++;
    }

    res.json({
      success: true,
      switchboard: { id: switchboardId, name: tableauName, code, building, floor },
      devices_created: devicesCreated
    });
  } catch (e) {
    console.error('[EXCEL IMPORT] error:', e.message);
    res.status(500).json({ error: 'Import failed' });
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
          content: 'Output ONLY valid JSON.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze electrical device. Extract: manufacturer, reference, is_differential (boolean). JSON only.`
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300
    });

    const result = JSON.parse(response.choices[0].message.content);
    const quick_ai_query = [result.manufacturer, result.reference].filter(Boolean).join(' ').trim() || null;

    res.json({ ...result, quick_ai_query });
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed' });
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
          content: `Expert electrical specs extraction. Return JSON: manufacturer, reference, device_type, in_amps (number), icu_ka (number), ics_ka (number), poles (number), voltage_v (number), trip_unit, is_differential (boolean), settings (ir, tr, isd, tsd, ii, ig, tg, zsi, erms, curve_type).` 
        },
        { role: 'user', content: `Extract specs: ${query}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    
    // Validate number fields
    const safeNum = (val) => {
      if (val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    const validated = {
      manufacturer: jsonResponse.manufacturer || null,
      reference: jsonResponse.reference || null,
      device_type: jsonResponse.device_type || 'Low Voltage Circuit Breaker',
      in_amps: safeNum(jsonResponse.in_amps),
      icu_ka: safeNum(jsonResponse.icu_ka),
      ics_ka: safeNum(jsonResponse.ics_ka),
      poles: safeNum(jsonResponse.poles) || 3,
      voltage_v: safeNum(jsonResponse.voltage_v) || 400,
      trip_unit: jsonResponse.trip_unit || null,
      is_differential: !!jsonResponse.is_differential,
      settings: jsonResponse.settings || {}
    };

    res.json(validated);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== SEARCH HELPERS ====================

// Search Downstream Switchboards (For linking functionality)
app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();

    const where = ['site = $1'];
    const vals = [site];
    let i = 2;
    if (query) {
      where.push(`(LOWER(name) ILIKE $${i} OR LOWER(code) ILIKE $${i})`);
      vals.push(`%${query}%`);
    }

    const { rows } = await pool.query(
      `SELECT id, name, code, building_code, floor, room
       FROM switchboards
       WHERE ${where.join(' AND ')}
       ORDER BY name
       LIMIT 20`, vals
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== GRAPH ====================

app.get('/api/switchboard/boards/:id/graph', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const rootId = Number(req.params.id);

    const buildTree = async (switchboardId) => {
      const { rows: devs } = await pool.query(
        'SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY position_number ASC NULLS LAST', 
        [switchboardId]
      );
      const byId = new Map(devs.map(d => [d.id, { ...d, children: [], downstream: null }]));
      const roots = [];
      for (const d of devs) {
        const node = byId.get(d.id);
        if (d.parent_id && byId.has(d.parent_id)) byId.get(d.parent_id).children.push(node);
        else roots.push(node);
      }
      for (const node of byId.values()) {
        if (node.downstream_switchboard_id) node.downstream = await buildTree(node.downstream_switchboard_id);
      }
      return { switchboard_id: switchboardId, devices: roots };
    };

    const graph = await buildTree(rootId);
    res.json(graph);
  } catch (e) {
    console.error('[SWITCHBOARD GRAPH] error:', e.message);
    res.status(500).json({ error: 'Graph failed' });
  }
});

// ==================== STATS & CALENDAR ====================

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

app.get('/api/switchboard/calendar', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { rows } = await pool.query(`
      SELECT sb.id, sb.name, sb.code, sb.building_code, sb.floor,
             COUNT(d.id)::int as device_count
      FROM switchboards sb
      LEFT JOIN devices d ON d.switchboard_id = sb.id
      WHERE sb.site = $1
      GROUP BY sb.id
      ORDER BY sb.building_code, sb.floor, sb.name
    `, [site]);
    res.json({ data: rows });
  } catch (e) {
    console.error('[CALENDAR] error:', e.message);
    res.status(500).json({ error: 'Calendar failed' });
  }
});

// ==================== START SERVER ====================

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`[SWITCHBOARD] Service running on :${port}`));
