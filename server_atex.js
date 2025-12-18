// ==============================
// server_atex.js — ATEX CMMS microservice (ESM)
// Port par défaut: 3001
// ✅ VERSION OPTIMISÉE (90% plus rapide)
// ✅ VERSION 2.0 - MULTI-TENANT (Company + Site)
// ==============================
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import StreamZip from "node-stream-zip";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { createRequire } from "module";
import { createCanvas } from "canvas";
import { extractTenantFromRequest, getTenantFilter, addTenantToData, enrichTenantWithSiteId } from "./lib/tenant-filter.js";
const require = createRequire(import.meta.url);
// --- OpenAI (extraction & conformité)
const { OpenAI } = await import("openai");
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.ATEX_PORT || 3001);
const HOST = process.env.ATEX_HOST || "0.0.0.0";
// Dossiers data
const DATA_DIR = process.env.ATEX_DATA_DIR || path.resolve(__dirname, "./_data_atex");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAPS_INCOMING_DIR = path.join(DATA_DIR, "maps_incoming");
const MAPS_DIR = path.join(DATA_DIR, "maps");
for (const d of [DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}

// -------------------------------------------------
// Helper: Generate a thumbnail from a PDF buffer
// Tries multiple methods: pdf2pic (GraphicsMagick/ImageMagick), sharp, then placeholder
// -------------------------------------------------
async function generatePdfThumbnail(pdfBuffer, thumbnailWidth = 300) {
  const thumbnailHeight = Math.floor(thumbnailWidth * 1.4);

  // Méthode 1: Essayer pdf2pic (nécessite GraphicsMagick ou ImageMagick)
  try {
    const { fromBuffer } = await import('pdf2pic');
    const converter = fromBuffer(pdfBuffer, {
      density: 150,
      saveFilename: 'thumbnail',
      savePath: '/tmp',
      format: 'png',
      width: thumbnailWidth,
      height: thumbnailHeight
    });

    const result = await converter(1); // Page 1
    if (result && result.path) {
      const thumbnailBuffer = await fsp.readFile(result.path);
      // Nettoyer le fichier temporaire
      await fsp.unlink(result.path).catch(() => {});
      console.log('[generatePdfThumbnail] Success with pdf2pic');
      return thumbnailBuffer;
    }
  } catch (pdf2picErr) {
    // pdf2pic a échoué (GraphicsMagick/ImageMagick non disponible)
    // console.log('[generatePdfThumbnail] pdf2pic failed:', pdf2picErr.message);
  }

  // Méthode 2: Essayer sharp (nécessite libvips avec poppler)
  try {
    const thumbnail = await sharp(pdfBuffer, { density: 100 })
      .resize(thumbnailWidth, thumbnailHeight, { fit: 'contain', background: '#ffffff' })
      .png()
      .toBuffer();
    console.log('[generatePdfThumbnail] Success with sharp');
    return thumbnail;
  } catch (sharpErr) {
    // sharp a échoué
    // console.log('[generatePdfThumbnail] sharp failed:', sharpErr.message);
  }

  // Méthode 3: Créer un placeholder basique (sera remplacé par le vrai thumbnail si généré côté client)
  console.log('[generatePdfThumbnail] Using placeholder (no conversion tool available)');
  return null; // Retourne null, le rapport utilisera le placeholder canvas
}

// -------------------------------------------------
// Helper: Convert PDF buffer to PNG image with optional marker
// Uses sharp for PDF conversion if available, otherwise creates a placeholder
// -------------------------------------------------
async function pdfToImageWithMarker(pdfBuffer, xFrac = null, yFrac = null, thumbnailWidth = 150, planName = 'Plan') {
  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      return null;
    }

    const thumbnailHeight = Math.floor(thumbnailWidth * 1.4); // Ratio A4 approximatif

    // Essayer d'utiliser sharp pour convertir le PDF (nécessite libvips avec support poppler)
    try {
      const pngBuffer = await sharp(pdfBuffer, { density: 72 })
        .resize(thumbnailWidth, thumbnailHeight, { fit: 'contain', background: '#ffffff' })
        .png()
        .toBuffer();

      // Si sharp a réussi, ajouter le marqueur avec canvas
      if (xFrac !== null && yFrac !== null && !isNaN(xFrac) && !isNaN(yFrac)) {
        // Charger l'image PNG dans un canvas pour ajouter le marqueur
        const { loadImage } = await import('canvas');
        const img = await loadImage(pngBuffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Dessiner le marqueur
        const markerX = xFrac * img.width;
        const markerY = yFrac * img.height;
        const markerRadius = Math.max(8, thumbnailWidth / 20);

        // Cercle rouge
        ctx.beginPath();
        ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#dc2626';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Point central
        ctx.beginPath();
        ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        return canvas.toBuffer('image/png');
      }

      return pngBuffer;
    } catch (sharpErr) {
      // Sharp n'a pas pu convertir le PDF, créer un placeholder visuel
      // console.log('[pdfToImageWithMarker] Sharp cannot convert PDF, creating placeholder');
    }

    // Créer un placeholder visuel avec le marqueur de position
    const canvas = createCanvas(thumbnailWidth, thumbnailHeight);
    const ctx = canvas.getContext('2d');

    // Fond gris clair
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, thumbnailWidth, thumbnailHeight);

    // Bordure
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, thumbnailWidth, thumbnailHeight);

    // Icône PDF stylisée
    const iconSize = thumbnailWidth * 0.3;
    const iconX = (thumbnailWidth - iconSize) / 2;
    const iconY = thumbnailHeight * 0.25;

    // Rectangle du document
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(iconX, iconY, iconSize, iconSize * 1.3);

    // Coin replié
    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.moveTo(iconX + iconSize * 0.7, iconY);
    ctx.lineTo(iconX + iconSize, iconY + iconSize * 0.3);
    ctx.lineTo(iconX + iconSize * 0.7, iconY + iconSize * 0.3);
    ctx.closePath();
    ctx.fill();

    // Texte "PDF"
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.floor(iconSize * 0.25)}px Helvetica`;
    ctx.textAlign = 'center';
    ctx.fillText('PDF', iconX + iconSize / 2, iconY + iconSize * 0.9);

    // Dessiner le marqueur de position si fourni
    if (xFrac !== null && yFrac !== null && !isNaN(xFrac) && !isNaN(yFrac)) {
      const markerX = xFrac * thumbnailWidth;
      const markerY = yFrac * thumbnailHeight;
      const markerRadius = Math.max(8, thumbnailWidth / 18);

      // Cercle extérieur rouge
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Point central blanc
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Ligne de pointage
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(markerX, markerY + markerRadius);
      ctx.lineTo(markerX, thumbnailHeight - 15);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Texte du nom du plan en bas
    ctx.fillStyle = '#374151';
    ctx.font = `${Math.floor(thumbnailWidth * 0.07)}px Helvetica`;
    ctx.textAlign = 'center';
    const shortName = planName.length > 20 ? planName.substring(0, 17) + '...' : planName;
    ctx.fillText(shortName, thumbnailWidth / 2, thumbnailHeight - 5);

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('[pdfToImageWithMarker] Error:', err.message);
    return null;
  }
}

// -------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
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
        "connect-src": ["*"], // API cross-origin ok
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
const multerFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const multerZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.ATEX_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});
// -------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Create table first (without indexes that depend on new columns)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      sub_equipment TEXT DEFAULT '',
      type TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      manufacturer_ref TEXT DEFAULT '',
      atex_mark_gas TEXT DEFAULT NULL,
      atex_mark_dust TEXT DEFAULT NULL,
      zoning_gas INTEGER NULL,
      zoning_dust INTEGER NULL,
      comment TEXT DEFAULT '',
      status TEXT DEFAULT 'a_faire',
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_eq_next ON atex_equipments(next_check_date);
  `);

  // Add multi-tenant columns if they don't exist (for existing databases)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE atex_equipments ADD COLUMN IF NOT EXISTS company_id INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE atex_equipments ADD COLUMN IF NOT EXISTS site_id INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);

  // Now create indexes on multi-tenant columns (columns are guaranteed to exist)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_eq_company ON atex_equipments(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_eq_site ON atex_equipments(site_id);`);

  // 🔥 MIGRATION: Peupler company_id/site_id pour les équipements existants (NULL)
  // Utilise le premier site trouvé comme valeur par défaut
  try {
    const defaultSiteRes = await pool.query(`SELECT id, company_id FROM sites ORDER BY id LIMIT 1`);
    if (defaultSiteRes.rows[0]) {
      const defaultSite = defaultSiteRes.rows[0];
      const updateRes = await pool.query(`
        UPDATE atex_equipments
        SET company_id = $1, site_id = $2
        WHERE company_id IS NULL OR site_id IS NULL
      `, [defaultSite.company_id, defaultSite.id]);
      if (updateRes.rowCount > 0) {
        console.log(`[ATEX] Migration: ${updateRes.rowCount} équipements mis à jour avec company_id=${defaultSite.company_id}, site_id=${defaultSite.id}`);
      }
    }
  } catch (migrationErr) {
    console.warn(`[ATEX] Migration tenant warning:`, migrationErr.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',
      date TIMESTAMP DEFAULT now(),
      items JSONB DEFAULT '[]'::jsonb,
      result TEXT DEFAULT NULL,
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      files JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_atex_checks_eq ON atex_checks(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_files_eq ON atex_files(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL,
      is_multi_zone BOOLEAN DEFAULT false,
      building_name TEXT DEFAULT '',
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_plans_logical ON atex_plans(logical_name);
  `);
  // Migration: add new columns if they don't exist (BEFORE creating indexes on them)
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS is_multi_zone BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS building_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS building TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS zone TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS company_id INTEGER`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS site_id INTEGER`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now()`);
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()`);
  // Migration: add thumbnail column for pre-generated plan thumbnails
  await pool.query(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS thumbnail BYTEA NULL`);
  // Now create indexes on new columns (after they exist)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_plans_company ON atex_plans(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_plans_site ON atex_plans(site_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      zone_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      UNIQUE (equipment_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_atex_positions_lookup ON atex_positions(logical_name, page_index);
    CREATE INDEX IF NOT EXISTS idx_atex_positions_equipment ON atex_positions(equipment_id);
  `);
  // Migration: add new columns to atex_positions if they don't exist
  await pool.query(`ALTER TABLE atex_positions ADD COLUMN IF NOT EXISTS zone_id UUID NULL`);
  await pool.query(`ALTER TABLE atex_positions ADD COLUMN IF NOT EXISTS company_id INTEGER`);
  await pool.query(`ALTER TABLE atex_positions ADD COLUMN IF NOT EXISTS site_id INTEGER`);
  await pool.query(`ALTER TABLE atex_positions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now()`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_subareas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      x1 NUMERIC NULL, y1 NUMERIC NULL,
      x2 NUMERIC NULL, y2 NUMERIC NULL,
      cx NUMERIC NULL, cy NUMERIC NULL, r NUMERIC NULL,
      points JSONB NULL,
      geometry JSONB DEFAULT '{}',
      name TEXT DEFAULT '',
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      color TEXT DEFAULT '#6B7280',
      zoning_gas INTEGER NULL,
      zoning_dust INTEGER NULL,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_subareas_lookup ON atex_subareas(logical_name, page_index);
  `);
  // Migration: add new columns to atex_subareas if they don't exist
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS geometry JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS building TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS zone TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#6B7280'`);
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS company_id INTEGER`);
  await pool.query(`ALTER TABLE atex_subareas ADD COLUMN IF NOT EXISTS site_id INTEGER`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '36_mois',
      checklist_template JSONB NOT NULL DEFAULT '[
        "Plaque de marquage ATEX lisible et complète ?",
        "Environnement libre de dépôts/obstructions (poussières) ?",
        "Câblage et presse-étoupes adaptés au zonage ?",
        "Étanchéité / boîtier intact (chocs/corrosion) ?",
        "Documentation disponible (certificats/conformité) ?"
      ]'::jsonb
    );
    INSERT INTO atex_settings(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_atex_events_action ON atex_events(action);
    CREATE INDEX IF NOT EXISTS idx_atex_events_time ON atex_events(ts DESC);
  `);

  // 🚀 NOUVEAUX INDEX POUR OPTIMISATION (résout le problème de lenteur)
  console.log('[ATEX] Creating performance indexes...');
  
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_atex_checks_equipment_date 
        ON atex_checks(equipment_id, date DESC NULLS LAST) 
        WHERE status = 'fait' AND result IS NOT NULL;
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_atex_checks_status 
        ON atex_checks(status) 
        WHERE status = 'fait';
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_atex_equipments_created 
        ON atex_equipments(created_at DESC);
    `);
    
    console.log('[ATEX] Performance indexes created ✅');
  } catch (e) {
    console.error('[ATEX] Error creating indexes (may already exist):', e.message);
  }

  // ============================================================
  // 🔌 INFRASTRUCTURE TABLES (Plans électriques multi-zones)
  // ============================================================
  console.log('[ATEX] Creating infrastructure tables...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      display_name TEXT,
      building_name TEXT DEFAULT '',
      filename TEXT NOT NULL,
      file_path TEXT,
      content BYTEA NULL,
      page_count INTEGER DEFAULT 1,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_infra_plans_company ON infrastructure_plans(company_id);
    CREATE INDEX IF NOT EXISTS idx_infra_plans_site ON infrastructure_plans(site_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id UUID REFERENCES infrastructure_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      kind TEXT DEFAULT 'rect',
      geometry JSONB DEFAULT '{}',
      color TEXT DEFAULT '#6B7280',
      page_index INTEGER DEFAULT 0,
      linked_atex_plans JSONB DEFAULT '[]',
      zoning_gas INTEGER NULL,
      zoning_dust INTEGER NULL,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_infra_zones_plan ON infrastructure_zones(plan_id);
  `);

  // Ajouter colonnes zoning_gas et zoning_dust si elles n'existent pas (migration)
  await pool.query(`ALTER TABLE infrastructure_zones ADD COLUMN IF NOT EXISTS zoning_gas INTEGER NULL`);
  await pool.query(`ALTER TABLE infrastructure_zones ADD COLUMN IF NOT EXISTS zoning_dust INTEGER NULL`);

  // infrastructure_positions stocke les équipements ATEX placés sur les plans d'infrastructure
  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      plan_id UUID NOT NULL REFERENCES infrastructure_plans(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES infrastructure_zones(id) ON DELETE SET NULL,
      page_index INTEGER DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      UNIQUE (equipment_id, plan_id, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_infra_pos_plan ON infrastructure_positions(plan_id);
    CREATE INDEX IF NOT EXISTS idx_infra_pos_equipment ON infrastructure_positions(equipment_id);
  `);

  console.log('[ATEX] Infrastructure tables created ✅');

  // ============================================================
  // MIGRATION: Move infrastructure data to unified atex tables
  // ============================================================
  console.log('[ATEX] Running infrastructure → atex migration...');

  try {
    // Check if there are infrastructure_plans not yet migrated
    const { rows: infraPlans } = await pool.query(`
      SELECT ip.* FROM infrastructure_plans ip
      WHERE NOT EXISTS (
        SELECT 1 FROM atex_plans ap
        WHERE ap.logical_name = 'infra_' || ip.id::text
      )
    `);

    if (infraPlans.length > 0) {
      console.log(`[ATEX] Migrating ${infraPlans.length} infrastructure plans...`);

      for (const plan of infraPlans) {
        const newLogicalName = 'infra_' + plan.id;

        // Insert into atex_plans with is_multi_zone = true
        await pool.query(`
          INSERT INTO atex_plans (
            id, logical_name, version, filename, file_path, page_count, content,
            is_multi_zone, building_name, company_id, site_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, 1, $2, $3, $4, $5,
            true, $6, $7, $8, $9, $10
          )
        `, [
          newLogicalName, plan.filename, plan.file_path || '', plan.page_count || 1, plan.content,
          plan.building_name || '', plan.company_id, plan.site_id, plan.created_at, plan.updated_at
        ]);

        // Also add to atex_plan_names for display
        await pool.query(`
          INSERT INTO atex_plan_names (logical_name, display_name)
          VALUES ($1, $2)
          ON CONFLICT (logical_name) DO UPDATE SET display_name = $2
        `, [newLogicalName, plan.display_name || plan.building_name || plan.logical_name]);

        // Migrate zones for this plan
        const { rows: zones } = await pool.query(`
          SELECT * FROM infrastructure_zones WHERE plan_id = $1
        `, [plan.id]);

        for (const zone of zones) {
          await pool.query(`
            INSERT INTO atex_subareas (
              logical_name, plan_id, page_index, kind, geometry,
              name, building, zone, color, zoning_gas, zoning_dust,
              company_id, site_id, created_at
            ) VALUES (
              $1, NULL, $2, $3, $4,
              $5, $6, $7, $8, $9, $10,
              $11, $12, $13
            )
          `, [
            newLogicalName, zone.page_index || 0, zone.kind || 'rect', zone.geometry || '{}',
            zone.name || '', '', '', zone.color || '#6B7280', zone.zoning_gas, zone.zoning_dust,
            zone.company_id, zone.site_id, zone.created_at
          ]);
        }

        // Migrate positions for this plan
        const { rows: positions } = await pool.query(`
          SELECT * FROM infrastructure_positions WHERE plan_id = $1
        `, [plan.id]);

        for (const pos of positions) {
          // Check if position already exists
          const { rows: existing } = await pool.query(`
            SELECT id FROM atex_positions
            WHERE equipment_id = $1 AND logical_name = $2 AND page_index = $3
          `, [pos.equipment_id, newLogicalName, pos.page_index || 0]);

          if (existing.length === 0) {
            await pool.query(`
              INSERT INTO atex_positions (
                equipment_id, logical_name, plan_id, zone_id, page_index, x_frac, y_frac,
                company_id, site_id, created_at
              ) VALUES (
                $1, $2, NULL, $3, $4, $5, $6,
                $7, $8, $9
              )
            `, [
              pos.equipment_id, newLogicalName, pos.zone_id, pos.page_index || 0, pos.x_frac, pos.y_frac,
              pos.company_id, pos.site_id, pos.created_at
            ]);
          }
        }

        console.log(`[ATEX] Migrated plan: ${plan.display_name || plan.logical_name} → ${newLogicalName}`);
      }

      console.log('[ATEX] Infrastructure migration completed ✅');
    } else {
      console.log('[ATEX] No new infrastructure plans to migrate');
    }
  } catch (migrationError) {
    console.error('[ATEX] Migration error (non-fatal):', migrationError.message);
  }

  // 🧹 Nettoyage automatique des positions en doublon
  try {
    const { rows: duplicates } = await pool.query(`
      SELECT equipment_id, COUNT(*) as count
      FROM atex_positions
      GROUP BY equipment_id
      HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      console.log(`[ATEX] Found ${duplicates.length} equipments with duplicate positions, cleaning up...`);
      for (const dup of duplicates) {
        await pool.query(`
          DELETE FROM atex_positions
          WHERE equipment_id = $1
          AND id NOT IN (
            SELECT id FROM atex_positions
            WHERE equipment_id = $1
            ORDER BY created_at DESC
            LIMIT 1
          )
        `, [dup.equipment_id]);
      }
      console.log('[ATEX] Duplicate positions cleaned up ✅');
    }
  } catch (cleanupError) {
    console.error('[ATEX] Cleanup error (non-fatal):', cleanupError.message);
  }
}
// -------------------------------------------------
// Utils
function eqStatusFromDue(due) {
  if (!due) return "a_faire";
  const d = new Date(due);
  const now = new Date();
  const diff = (d - now) / (1000 * 3600 * 24);
  if (diff < 0) return "en_retard";
  if (diff <= 90) return "en_cours_30";
  return "a_faire";
}
function addMonths(date, m) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + m);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fileUrlFromPath(p) {
  return `/api/atex/file?path=${encodeURIComponent(p)}`;
}
function isUuid(s = "") {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}
async function logEvent(req, action, details = {}) {
  const u = getUser(req);
  try {
    await pool.query(
      `INSERT INTO atex_events(actor_name, actor_email, action, details) VALUES($1,$2,$3,$4)`,
      [u.name || null, u.email || null, action, JSON.stringify(details || {})]
    );
  } catch (e) {
    console.warn("[events] failed to log", action, e.message);
  }
  console.log(`[atex][${action}]`, { by: u.email || u.name || "anon", ...details });
}
// Helpers pour contexte plan/sous-zone → fiche équipement
async function getPlanDisplayName(logical_name) {
  const { rows } = await pool.query(
    `SELECT display_name FROM atex_plan_names WHERE logical_name=$1 LIMIT 1`,
    [logical_name]
  );
  return rows?.[0]?.display_name || logical_name;
}
async function getSubareaNameById(id) {
  if (!id) return null;
  const { rows } = await pool.query(`SELECT name FROM atex_subareas WHERE id=$1`, [id]);
  const nm = (rows?.[0]?.name || "").trim();
  return nm || null;
}
// -------------------------------------------------
// Health / File
app.get("/api/atex/health", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM atex_equipments`);
    res.json({ ok: true, equipments: rows?.[0]?.n ?? 0, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/atex/file", async (req, res) => {
  try {
    const p = String(req.query.path || "");
    const abs = path.resolve(p);
    if (!abs.startsWith(DATA_DIR)) return res.status(403).json({ ok: false });
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false });
    res.sendFile(abs);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// -------------------------------------------------
/** EQUIPEMENTS — 🔥 VERSION OPTIMISÉE **/
app.get("/api/atex/equipments", async (req, res) => {
  try {
    console.time('[ATEX] GET /api/atex/equipments'); // 🔍 Log de timing

    // 🏢 MULTI-TENANT: Extraire les infos tenant depuis la requête
    // 🔥 Enrichir avec site_id depuis X-Site si manquant (pour utilisateurs externes)
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);
    const tenantFilter = getTenantFilter(tenant, { tableAlias: 'e' });

    const q = (req.query.q || "").toString().trim().toLowerCase();
    const statusFilter = (req.query.status || "").toString().trim();
    const building = (req.query.building || "").toString().trim().toLowerCase();
    const zone = (req.query.zone || "").toString().trim().toLowerCase();
    const compliance = (req.query.compliance || "").toString().trim();

    // 🔥 NOUVEAU : Support du paramètre limit
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 1000)));

    // 🚀 OPTIMISATION : Requête avec JOIN au lieu de sous-requêtes corrélées
    // 🏢 MULTI-TENANT: Filtrage par company_id/site_id
    // 📍 Ajout de la position actuelle (logical_name) pour savoir sur quel plan l'équipement est placé
    const { rows } = await pool.query(
      `
      WITH last_checks AS (
        SELECT DISTINCT ON (equipment_id)
               equipment_id,
               date AS last_check_date,
               result
        FROM atex_checks
        WHERE status = 'fait' AND result IS NOT NULL
        ORDER BY equipment_id, date DESC NULLS LAST
      ),
      current_positions AS (
        SELECT DISTINCT ON (equipment_id)
               equipment_id,
               logical_name,
               plan_id
        FROM atex_positions
        ORDER BY equipment_id, created_at DESC
      )
      SELECT
        e.id,
        e.company_id,
        e.site_id,
        e.name,
        e.type,
        e.manufacturer,
        e.manufacturer_ref,
        e.building,
        e.zone,
        e.equipment,
        e.sub_equipment,
        e.atex_mark_gas,
        e.atex_mark_dust,
        e.zoning_gas,
        e.zoning_dust,
        e.comment,
        e.status,
        e.installed_at,
        e.next_check_date,
        e.photo_path,
        e.created_at,
        e.updated_at,
        lc.last_check_date,
        lc.result AS last_result,
        cp.logical_name,
        cp.plan_id AS position_plan_id
      FROM atex_equipments e
      LEFT JOIN last_checks lc ON lc.equipment_id = e.id
      LEFT JOIN current_positions cp ON cp.equipment_id = e.id
      WHERE ${tenantFilter.where}
      ORDER BY e.created_at DESC
      LIMIT $${tenantFilter.nextParam}
      `,
      [...tenantFilter.params, limit]
    );
    
    console.log(`[ATEX] Query returned ${rows.length} rows`); // 🔍 Log
    
    // Reste du code inchangé (mapping des items)
    let items = rows.map((r) => {
      const computed_status = eqStatusFromDue(r.next_check_date);
      const compliance_state =
        r.last_result === "conforme"
          ? "conforme"
          : r.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
      const hay = [
        r.name,
        r.building,
        r.zone,
        r.equipment,
        r.sub_equipment,
        r.type,
        r.manufacturer,
        r.manufacturer_ref,
        r.atex_mark_gas,
        r.atex_mark_dust,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return {
        ...r,
        status: computed_status,
        compliance_state,
        photo_url:
          r.photo_path
            ? `/api/atex/equipments/${r.id}/photo`
            : null,
        __hay: hay,
      };
    });
    
    // Filtres côté serveur (inchangé)
    if (q) items = items.filter((it) => it.__hay.includes(q));
    if (building) items = items.filter((it) => (it.building || "").toLowerCase().includes(building));
    if (zone) items = items.filter((it) => (it.zone || "").toLowerCase().includes(zone));
    if (statusFilter) items = items.filter((it) => it.status === statusFilter);
    if (compliance === "conforme") items = items.filter((it) => it.compliance_state === "conforme");
    if (compliance === "non_conforme") items = items.filter((it) => it.compliance_state === "non_conforme");
    if (compliance === "na") items = items.filter((it) => it.compliance_state === "na");
    
    items = items.map(({ __hay, ...x }) => x);
    
    console.timeEnd('[ATEX] GET /api/atex/equipments'); // 🔍 Log de timing
    
    res.json({ items });
  } catch (e) {
    console.error('[ATEX] Error in GET /api/atex/equipments:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `
      SELECT e.*,
             (SELECT MAX(date) FROM atex_checks c WHERE c.equipment_id=e.id) AS last_check_date,
             (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
      FROM atex_equipments e WHERE e.id=$1
      `,
      [id]
    );
    const eq = rows?.[0] || null;
    if (!eq) return res.status(404).json({ ok: false, error: "not found" });
    // ✅ alignement avec la liste: status dynamique + compliance_state + photo_url
    eq.status = eqStatusFromDue(eq.next_check_date);
    eq.compliance_state =
      eq.last_result === "conforme"
        ? "conforme"
        : eq.last_result === "non_conforme"
        ? "non_conforme"
        : "na";
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/atex/equipments/${id}/photo`
        : null;
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/atex/equipments", async (req, res) => {
  try {
    // 🏢 MULTI-TENANT: Extraire les infos tenant
    // 🔥 Enrichir avec site_id depuis X-Site si manquant (pour utilisateurs externes)
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    const {
      name = "",
      building = "",
      zone = "",
      equipment = "",
      sub_equipment = "",
      type = "",
      manufacturer = "",
      manufacturer_ref = "",
      atex_mark_gas = null,
      atex_mark_dust = null,
      comment = "",
      installed_at = null,
    } = req.body || {};
    // 36 mois après l'installation (ou maintenant si non fourni)
    const installDate = installed_at ? new Date(installed_at) : new Date();
    const firstDue = addMonths(installDate, 36);
    const { rows } = await pool.query(
      `
      INSERT INTO atex_equipments
        (company_id, site_id, name, building, zone, equipment, sub_equipment, type,
         manufacturer, manufacturer_ref, atex_mark_gas, atex_mark_dust,
         comment, installed_at, next_check_date, zoning_gas, zoning_dust)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,NULL)
      RETURNING *
      `,
      [
        tenant.companyId,
        tenant.siteId,
        name || "Équipement ATEX",
        building,
        zone,
        equipment,
        sub_equipment,
        type,
        manufacturer,
        manufacturer_ref,
        atex_mark_gas || null,
        atex_mark_dust || null,
        comment,
        installDate,
        firstDue,
      ]
    );
    const eq = rows[0];
    eq.photo_url = null;
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.put("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const fields = [
      "name","building","zone","equipment","sub_equipment","type",
      "manufacturer","manufacturer_ref","atex_mark_gas","atex_mark_dust",
      "comment","installed_at","next_check_date","status",
      "zoning_gas","zoning_dust"
    ];
    const set = [];
    const values = [];
    let i = 1;
    for (const k of fields) {
      if (k in req.body) {
        set.push(`${k}=$${i++}`);
        values.push(req.body[k]);
      }
    }
    if (!set.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE atex_equipments SET ${set.join(", ")}, updated_at=now() WHERE id=$${i}`, values);
    const { rows } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const eq = rows?.[0] || null;
    if (eq) {
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
    }
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.delete("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_equipments WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 🔄 DUPLICATION D'ÉQUIPEMENT
// ============================================================
app.post("/api/atex/equipments/:id/duplicate", async (req, res) => {
  try {
    const sourceId = String(req.params.id);
    const { copy_position = false, target_plan = null } = req.body || {};

    // 1. Récupérer l'équipement source
    const { rows: srcRows } = await pool.query(
      `SELECT * FROM atex_equipments WHERE id=$1`,
      [sourceId]
    );
    const source = srcRows[0];
    if (!source) return res.status(404).json({ ok: false, error: "Équipement non trouvé" });

    // 2. Créer la copie (nouveau UUID, nom avec suffixe)
    const { rows: newRows } = await pool.query(
      `INSERT INTO atex_equipments (
        name, building, zone, equipment, sub_equipment, type,
        manufacturer, manufacturer_ref, atex_mark_gas, atex_mark_dust,
        comment, installed_at, next_check_date, status,
        zoning_gas, zoning_dust, company_id, site_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, 'a_faire', $14, $15, $16, $17, now(), now()
      ) RETURNING *`,
      [
        source.name + " (copie)",
        source.building,
        source.zone,
        source.equipment,
        source.sub_equipment,
        source.type,
        source.manufacturer,
        source.manufacturer_ref,
        source.atex_mark_gas,
        source.atex_mark_dust,
        source.comment,
        source.installed_at,
        null, // next_check_date reset
        source.zoning_gas,
        source.zoning_dust,
        source.company_id,
        source.site_id,
      ]
    );
    const newEquipment = newRows[0];

    // 3. Copier la photo si elle existe
    if (source.photo_content && source.photo_content.length) {
      await pool.query(
        `UPDATE atex_equipments SET photo_content=$1, photo_path=$2 WHERE id=$3`,
        [source.photo_content, source.photo_path, newEquipment.id]
      );
      newEquipment.photo_url = `/api/atex/equipments/${newEquipment.id}/photo`;
    }

    // 4. Optionnel: copier la position vers le plan cible ou le même plan
    if (copy_position) {
      const { rows: posRows } = await pool.query(
        `SELECT * FROM atex_positions WHERE equipment_id=$1`,
        [sourceId]
      );
      for (const pos of posRows) {
        const targetLogical = target_plan || pos.logical_name;
        await pool.query(
          `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (equipment_id, logical_name, page_index) DO NOTHING`,
          [newEquipment.id, targetLogical, pos.plan_id, pos.page_index, pos.x_frac, pos.y_frac]
        );
      }
    }

    res.json({ ok: true, equipment: newEquipment });
  } catch (e) {
    console.error('[duplicate] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 📍 DÉPLACER ÉQUIPEMENT VERS UN AUTRE PLAN
// ============================================================
app.put("/api/atex/maps/positions/:equipmentId/move", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    const {
      from_logical_name,
      to_logical_name,
      to_plan_id = null,
      to_page_index = 0,
      x_frac = 0.5,
      y_frac = 0.5
    } = req.body || {};

    if (!equipment_id || !to_logical_name) {
      return res.status(400).json({ ok: false, error: "missing to_logical_name" });
    }

    // 1. Supprimer l'ancienne position si spécifiée
    if (from_logical_name) {
      await pool.query(
        `DELETE FROM atex_positions
         WHERE equipment_id=$1 AND logical_name=$2`,
        [equipment_id, from_logical_name]
      );
    }

    // 2. Créer la nouvelle position sur le plan cible
    await pool.query(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac, plan_id=EXCLUDED.plan_id`,
      [equipment_id, to_logical_name, isUuid(to_plan_id) ? to_plan_id : null, to_page_index, x_frac, y_frac]
    );

    res.json({ ok: true, moved: true });

    // 3. Mettre à jour le contexte de zone en arrière-plan
    setImmediate(async () => {
      try {
        const zones = await detectZonesForPoint(to_logical_name, to_page_index, Number(x_frac), Number(y_frac));
        await updateEquipmentContext({
          equipment_id,
          logical_name: to_logical_name,
          zoning_gas: zones.zoning_gas,
          zoning_dust: zones.zoning_dust,
          subarea_id: zones.subarea_id,
          subarea_name_hint: zones.subarea_name || null,
        });
      } catch (bgErr) {
        console.error('[move position background] Error:', bgErr.message);
      }
    });
  } catch (e) {
    console.error('[move position] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 🗑️ SUPPRIMER POSITION D'UN PLAN (sans supprimer l'équipement)
// ============================================================
app.delete("/api/atex/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    const { logical_name, page_index } = req.query || {};

    if (!logical_name) {
      // Supprimer toutes les positions de cet équipement
      await pool.query(
        `DELETE FROM atex_positions WHERE equipment_id=$1`,
        [equipment_id]
      );
    } else if (page_index != null) {
      // Supprimer une position spécifique
      await pool.query(
        `DELETE FROM atex_positions
         WHERE equipment_id=$1 AND logical_name=$2 AND page_index=$3`,
        [equipment_id, logical_name, page_index]
      );
    } else {
      // Supprimer toutes les positions sur ce plan
      await pool.query(
        `DELETE FROM atex_positions
         WHERE equipment_id=$1 AND logical_name=$2`,
        [equipment_id, logical_name]
      );
    }

    res.json({ ok: true, removed: true });
  } catch (e) {
    console.error('[delete position] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🧹 NETTOYAGE - Supprime les positions en doublon (garde seulement la plus récente par équipement)
app.post("/api/atex/maps/cleanup-duplicates", async (req, res) => {
  try {
    // 1. Trouver les équipements avec plusieurs positions
    const { rows: duplicates } = await pool.query(`
      SELECT equipment_id, COUNT(*) as count
      FROM atex_positions
      GROUP BY equipment_id
      HAVING COUNT(*) > 1
    `);

    console.log(`[cleanup] Found ${duplicates.length} equipments with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      // Garder seulement la position la plus récente (par created_at)
      const result = await pool.query(`
        DELETE FROM atex_positions
        WHERE equipment_id = $1
        AND id NOT IN (
          SELECT id FROM atex_positions
          WHERE equipment_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        )
      `, [dup.equipment_id]);
      totalRemoved += result.rowCount;
      console.log(`[cleanup] Equipment ${dup.equipment_id}: removed ${result.rowCount} duplicate positions`);
    }

    res.json({
      ok: true,
      duplicates_found: duplicates.length,
      positions_removed: totalRemoved
    });
  } catch (e) {
    console.error('[cleanup] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Photos / Files
app.post("/api/atex/equipments/:id/photo", multerFiles.single("photo"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"no file" });
    let buf = null;
    try { buf = await fsp.readFile(file.path); } catch {}
    await pool.query(
      `UPDATE atex_equipments
         SET photo_path=$1,
             photo_content=COALESCE($2, photo_content),
             updated_at=now()
       WHERE id=$3`,
      [file.path, buf, id]
    );
    res.json({ ok:true, url:`/api/atex/equipments/${id}/photo` });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ VERSION OPTIMISÉE - Génère des thumbnails si thumb=1
app.get("/api/atex/equipments/:id/photo", async (req, res) => {
  try {
    const id = String(req.params.id);
    const wantThumb = req.query.thumb === "1" || req.query.thumb === "true";
    const thumbSize = 200; // pixels max pour le côté le plus long

    const { rows } = await pool.query(
      `SELECT photo_path, photo_content FROM atex_equipments WHERE id=$1`,
      [id]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).end();

    let imageBuffer = null;

    // 1. Priorité au contenu binaire stocké en DB
    if (row.photo_content && row.photo_content.length) {
      imageBuffer = row.photo_content;
    }
    // 2. Sinon, lire depuis le fichier
    else if (row.photo_path && fs.existsSync(row.photo_path)) {
      imageBuffer = await fsp.readFile(row.photo_path);
    }

    if (!imageBuffer) return res.status(404).end();

    // 3. Si thumbnail demandé, redimensionner et compresser
    if (wantThumb) {
      try {
        const thumb = await sharp(imageBuffer)
          .resize(thumbSize, thumbSize, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();

        res.type("image/jpeg");
        res.set("Cache-Control", "public, max-age=3600"); // Cache 1h
        return res.end(thumb, "binary");
      } catch (sharpErr) {
        console.error("[photo] Sharp error:", sharpErr.message);
        // Fallback: envoyer l'original si sharp échoue
      }
    }

    // 4. Envoyer l'image originale
    res.type("image/jpeg");
    res.set("Cache-Control", "public, max-age=86400"); // Cache 24h pour les originaux
    return res.end(imageBuffer, "binary");
  } catch (e) {
    console.error("[photo] Error:", e.message);
    res.status(404).end();
  }
});
app.get("/api/atex/equipments/:id/files", async (req,res)=>{ try{
  const id = String(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM atex_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`, [id]);
  const files = rows.map((r)=>({
    id:r.id,
    original_name:r.original_name,
    mime:r.mime,
    download_url:`/api/atex/files/${r.id}/download`,
    inline_url:`/api/atex/files/${r.id}/download`,
  }));
  res.json({ files });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.post("/api/atex/equipments/:id/files", multerFiles.array("files"), async (req,res)=>{ try{
  const id = String(req.params.id);
  for (const f of (req.files||[])) {
    let buf = null;
    try { buf = await fsp.readFile(f.path); } catch {}
    await pool.query(
      `INSERT INTO atex_files (equipment_id, original_name, mime, file_path, file_content)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, f.originalname, f.mimetype, f.path, buf]
    );
  }
  res.json({ ok:true });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.get("/api/atex/files/:fileId/download", async (req, res) => {
  try {
    const id = String(req.params.fileId);
    const { rows } = await pool.query(
      `SELECT original_name, mime, file_path, file_content FROM atex_files WHERE id=$1`,
      [id]
    );
    const r = rows?.[0];
    if (!r) return res.status(404).end();
    const filename = r.original_name || "file";
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    if (r.file_content && r.file_content.length) {
      if (r.mime) res.type(r.mime);
      return res.end(r.file_content, "binary");
    }
    if (r.file_path && fs.existsSync(r.file_path)) {
      if (r.mime) res.type(r.mime);
      return res.sendFile(path.resolve(r.file_path));
    }
    return res.status(404).end();
  } catch { res.status(500).json({ ok:false }); }
});
app.delete("/api/atex/files/:fileId", async (req,res)=>{ try{
  const id = String(req.params.fileId);
  const { rows } = await pool.query(`DELETE FROM atex_files WHERE id=$1 RETURNING file_path`, [id]);
  const fp = rows?.[0]?.file_path; if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok:true });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
// -------------------------------------------------
// Settings / Checks / Calendar
app.get("/api/atex/settings", async (_req, res) => {
  try { const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`); res.json(rows?.[0] || {}); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.put("/api/atex/settings", async (req, res) => {
  try {
    const { frequency, checklist_template } = req.body || {};
    await pool.query(
      `UPDATE atex_settings SET frequency=COALESCE($1, frequency), checklist_template=COALESCE($2, checklist_template) WHERE id=1`,
      [frequency || null, Array.isArray(checklist_template) ? JSON.stringify(checklist_template) : null]
    );
    const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`);
    res.json(rows?.[0] || {});
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post("/api/atex/equipments/:id/checks", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, user_name, user_email) VALUES($1,'a_faire',$2,$3) RETURNING *`,
      [id, u.name || "", u.email || ""]
    );
    res.json({ check: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.put("/api/atex/equipments/:id/checks/:checkId", multerFiles.array("files"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const checkId = String(req.params.checkId);
    let items = [], close = false;
    if (req.is("multipart/form-data")) { items = JSON.parse(req.body.items || "[]"); close = String(req.body.close || "false")==="true"; }
    else { items = req.body.items || []; close = !!req.body.close; }
    const filesArr = (req.files||[]).map(f=>({ name:f.originalname, mime:f.mimetype, path:f.path, url:fileUrlFromPath(f.path) }));
    await pool.query(`UPDATE atex_checks SET items=$1, files=$2 WHERE id=$3`, [JSON.stringify(items), JSON.stringify(filesArr), checkId]);
    if (close) {
      const values2 = await pool.query(`SELECT items FROM atex_checks WHERE id=$1`, [checkId]);
      const its = values2?.rows?.[0]?.items || [];
      const vals = (its || []).slice(0, 5).map((i) => i?.value).filter(Boolean);
      const result = vals.includes("non_conforme") ? "non_conforme" : (vals.length ? "conforme" : null);
      const nextDate = addMonths(new Date(), 36);
      await pool.query(`UPDATE atex_equipments SET next_check_date=$1, updated_at=now() WHERE id=$2`, [nextDate, id]);
      await pool.query(`UPDATE atex_checks SET status='fait', result=$1, date=now() WHERE id=$2`, [result, checkId]);
    }
    const { rows: eqR } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const equipment = eqR?.[0] || null;
    if (equipment) {
      equipment.photo_url =
        (equipment.photo_content && equipment.photo_content.length) || equipment.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
      equipment.status = eqStatusFromDue(equipment.next_check_date);
    }
    res.json({ ok:true, equipment });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ Quick check (valider un contrôle aujourd'hui sans formulaire)
app.post("/api/atex/equipments/:id/quickCheck", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    // 1) créer un "check" minimal, déjà "fait"
    const { rows: chk } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, date, items, result, user_name, user_email, files)
       VALUES($1,'fait',now(),'[]'::jsonb,NULL,$2,$3,'[]'::jsonb)
       RETURNING *`,
      [id, u.name || "", u.email || ""]
    );

    // 2) recalculer l'échéance (36 mois après aujourd'hui)
    const nextDate = addMonths(new Date(), 36);
    await pool.query(
      `UPDATE atex_equipments SET next_check_date=$1, updated_at=now() WHERE id=$2`,
      [nextDate, id]
    );

    // 3) renvoyer la fiche recalculée
    const { rows: eqR } = await pool.query(
      `
      SELECT e.*,
             (SELECT MAX(date) FROM atex_checks c WHERE c.equipment_id=e.id) AS last_check_date,
             (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
      FROM atex_equipments e WHERE e.id=$1
      `,
      [id]
    );
    const eq = eqR?.[0] || null;
    if (eq) {
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.compliance_state =
        eq.last_result === "conforme" ? "conforme" :
        eq.last_result === "non_conforme" ? "non_conforme" : "na";
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
    }

    res.json({ ok: true, check: chk[0], equipment: eq });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
app.get("/api/atex/equipments/:id/history", async (req,res)=>{ try{
  const id = String(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM atex_checks WHERE equipment_id=$1 ORDER BY date DESC`, [id]);
  res.json({ checks: rows || [] });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.get("/api/atex/calendar", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id as equipment_id, name as equipment_name, next_check_date as date
      FROM atex_equipments
      WHERE next_check_date IS NOT NULL
      ORDER BY next_check_date ASC
    `);
    const events = (rows || []).map((r) => ({
      date: r.date,
      equipment_id: r.equipment_id,
      equipment_name: r.equipment_name,
      status: eqStatusFromDue(r.date),
    }));
    res.json({ events });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// -------------------------------------------------
// MAPS — Upload ZIP + list + rename + file URL
app.post("/api/atex/maps/uploadZip", multerZip.single("zip"), async (req, res) => {
  try {
    const zipPath = req.file?.path;
    if (!zipPath) return res.status(400).json({ ok: false, error: "zip missing" });
    const zip = new StreamZip.async({ file: zipPath, storeEntries: true });
    const imported = [];
    try {
      const entries = await zip.entries();
      const files = Object.values(entries).filter(
        (e) => !e.isDirectory && /\.pdf$/i.test(e.name)
      );
      for (const entry of files) {
        const rawName = entry.name.split("/").pop();
        const { name: baseName } = path.parse(rawName || entry.name);
        const base = baseName || "plan";
        const logical = base.replace(/[^\w.-]+/g, "_").toLowerCase();
        const version = Math.floor(Date.now() / 1000);
        const dest = path.join(MAPS_DIR, `${logical}__${version}.pdf`);
        
        // === CORRECTION IMPORTANTE ICI ===
        // On récupère les infos de la version précédente avant d'insérer la nouvelle
        const { rows: prev } = await pool.query(
          `SELECT building, zone FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
          [logical]
        );
        const existingBuilding = prev?.[0]?.building || "";
        const existingZone = prev?.[0]?.zone || "";
        // ================================

        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await zip.extract(entry.name, dest);
        
        let buf = null;
        try { buf = await fsp.readFile(dest); } catch { buf = null; }
        const page_count = 1;

        // On insère en remettant les infos building/zone récupérées juste avant
        if (buf) {
          await pool.query(
            `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count, content, building, zone)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [logical, version, path.basename(dest), dest, page_count, buf, existingBuilding, existingZone]
          );
        } else {
          await pool.query(
            `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count, building, zone)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [logical, version, path.basename(dest), dest, page_count, existingBuilding, existingZone]
          );
        }
        
        await pool.query(
          `INSERT INTO atex_plan_names (logical_name, display_name) VALUES ($1,$2)
           ON CONFLICT (logical_name) DO NOTHING`,
          [logical, base]
        );
        imported.push({ logical_name: logical, version, page_count });
      }
    } finally {
      await zip.close().catch(()=>{});
      fs.rmSync(zipPath, { force: true });
    }
    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload single PDF plan (supports multi-zone option for infrastructure plans)
// Now accepts optional thumbnail generated by client
const multerPlanWithThumbnail = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

app.post("/api/atex/maps/uploadPlan", multerPlanWithThumbnail, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const building_name = req.body.building_name || "";
    const is_multi_zone = req.body.is_multi_zone === "true" || req.body.is_multi_zone === true;
    const originalName = file.originalname || "plan.pdf";
    const baseName = originalName.replace(/\.[^.]+$/, "");
    const logical = baseName.replace(/[^\w.-]+/g, "_").toLowerCase();
    const version = Math.floor(Date.now() / 1000);
    const dest = path.join(MAPS_DIR, `${logical}__${version}.pdf`);

    // Check for previous version to preserve building/zone
    const { rows: prev } = await pool.query(
      `SELECT building, zone FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
      [logical]
    );
    const existingBuilding = prev?.[0]?.building || "";
    const existingZone = prev?.[0]?.zone || "";

    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, file.buffer);

    // Utiliser le thumbnail fourni par le client, sinon essayer de le générer côté serveur
    let thumbnailBuffer = null;
    const clientThumbnail = req.files?.thumbnail?.[0];
    if (clientThumbnail && clientThumbnail.buffer) {
      thumbnailBuffer = clientThumbnail.buffer;
      console.log('[uploadPlan] Using client-provided thumbnail');
    } else {
      try {
        thumbnailBuffer = await generatePdfThumbnail(file.buffer, 400);
      } catch (thumbErr) {
        console.warn('[uploadPlan] Thumbnail generation failed:', thumbErr.message);
      }
    }

    // Insert into atex_plans with multi-zone flag and thumbnail
    await pool.query(
      `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count, content, building, zone, is_multi_zone, building_name, thumbnail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [logical, version, path.basename(dest), dest, 1, file.buffer, existingBuilding, existingZone, is_multi_zone, building_name, thumbnailBuffer]
    );

    // Insert display name
    await pool.query(
      `INSERT INTO atex_plan_names (logical_name, display_name) VALUES ($1,$2)
       ON CONFLICT (logical_name) DO NOTHING`,
      [logical, baseName]
    );

    const { rows } = await pool.query(
      `SELECT id, logical_name, version, page_count, is_multi_zone, building_name, building, zone FROM atex_plans WHERE logical_name=$1 AND version=$2`,
      [logical, version]
    );

    res.json({ ok: true, plan: rows[0], thumbnailGenerated: !!thumbnailBuffer });
  } catch (e) {
    console.error("[atex] upload plan error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ⚙️ listPlans => id = UUID de la dernière version
app.get("/api/atex/maps/listPlans", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id,
             p.logical_name,
             p.version,
             COALESCE(p.page_count, 1) AS page_count,
             p.building,
             p.zone,
             COALESCE(p.is_multi_zone, false) AS is_multi_zone,
             COALESCE(p.building_name, '') AS building_name,
             (SELECT display_name
                FROM atex_plan_names n
               WHERE n.logical_name = p.logical_name
               LIMIT 1) AS display_name
      FROM atex_plans p
      ORDER BY p.logical_name, p.version DESC
    `);

    const plans = rows.map((r) => ({
      id: r.id,
      logical_name: r.logical_name,
      version: Number(r.version || 1),
      page_count: Number(r.page_count || 1),
      display_name: r.display_name || r.logical_name,
      building: r.building || "",
      zone: r.zone || "",
      is_multi_zone: r.is_multi_zone || false,
      building_name: r.building_name || "",
    }));

    res.json({ plans, items: plans });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Alias compat (si l'ancien front appelle encore /plans)
app.get("/api/atex/maps/plans", (req, res) =>
  app._router.handle(Object.assign(req, { url: "/api/atex/maps/listPlans" }), res)
);
app.put("/api/atex/maps/renamePlan", async (req, res) => {
  try {
    const { logical_name, display_name } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });
    await pool.query(
      `INSERT INTO atex_plan_names (logical_name, display_name)
         VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, String(display_name || "").trim() || logical_name]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// 🗑️ Supprimer un plan (et ses positions/sous-zones associées)
app.delete("/api/atex/maps/plans/:id", async (req, res) => {
  try {
    const planId = req.params.id;

    // 1. Récupérer le logical_name du plan
    const { rows } = await pool.query(
      `SELECT logical_name FROM atex_plans WHERE id = $1`,
      [planId]
    );
    const logicalName = rows?.[0]?.logical_name;

    if (!logicalName) {
      return res.status(404).json({ ok: false, error: "Plan not found" });
    }

    console.log(`[deletePlan] Deleting plan ${planId} (logical_name: ${logicalName})`);

    // 2. Supprimer les positions sur ce plan (ne supprime PAS l'équipement, juste la position)
    const posResult = await pool.query(
      `DELETE FROM atex_positions WHERE logical_name = $1`,
      [logicalName]
    );
    console.log(`[deletePlan] Removed ${posResult.rowCount} positions`);

    // 3. Supprimer les sous-zones (subareas) de ce plan
    const subResult = await pool.query(
      `DELETE FROM atex_subareas WHERE logical_name = $1`,
      [logicalName]
    );
    console.log(`[deletePlan] Removed ${subResult.rowCount} subareas`);

    // 4. Supprimer le nom d'affichage
    await pool.query(
      `DELETE FROM atex_plan_names WHERE logical_name = $1`,
      [logicalName]
    );

    // 5. Supprimer toutes les versions du plan
    const planResult = await pool.query(
      `DELETE FROM atex_plans WHERE logical_name = $1`,
      [logicalName]
    );
    console.log(`[deletePlan] Removed ${planResult.rowCount} plan versions`);

    // 6. Si c'est un plan migré depuis infrastructure, supprimer aussi l'original
    //    pour éviter qu'il soit recréé au prochain démarrage
    let infraDeleted = 0;
    if (logicalName.startsWith('infra_')) {
      const infraId = logicalName.replace('infra_', '');
      try {
        // Supprimer zones et positions infrastructure d'abord
        await pool.query(`DELETE FROM infrastructure_positions WHERE plan_id = $1`, [infraId]);
        await pool.query(`DELETE FROM infrastructure_zones WHERE plan_id = $1`, [infraId]);
        const infraResult = await pool.query(`DELETE FROM infrastructure_plans WHERE id = $1`, [infraId]);
        infraDeleted = infraResult.rowCount;
        console.log(`[deletePlan] Also removed original infrastructure plan ${infraId}`);
      } catch (e) {
        console.warn(`[deletePlan] Could not delete infrastructure_plans ${infraId}:`, e.message);
      }
    }

    res.json({
      ok: true,
      deleted: {
        positions: posResult.rowCount,
        subareas: subResult.rowCount,
        plans: planResult.rowCount,
        infrastructure: infraDeleted
      }
    });
  } catch (e) {
    console.error('[deletePlan] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 Fichier du plan
app.get("/api/atex/maps/planFile", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString();
    const id = (req.query.id || "").toString();
    if (id && isUuid(id)) {
      const { rows } = await pool.query(
        `SELECT file_path, content FROM atex_plans WHERE id=$1 ORDER BY version DESC LIMIT 1`,
        [id]
      );
      const row = rows?.[0] || null;
      if (row?.content?.length) {
        res.type("application/pdf");
        return res.end(row.content, "binary");
      }
      const fp = row?.file_path;
      if (fp && fs.existsSync(fp)) return res.type("application/pdf").sendFile(path.resolve(fp));
      return res.status(404).send("not_found");
    }
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name required" });
    let rows = (
      await pool.query(
        `SELECT file_path, content FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
        [logical]
      )
    ).rows;
    if (!rows?.length) {
      rows = (
        await pool.query(
          `SELECT file_path, content FROM atex_plans WHERE lower(logical_name)=lower($1) ORDER BY version DESC LIMIT 1`,
          [logical]
        )
      ).rows;
    }
    let row = rows?.[0] || null;
    if (row?.content?.length) {
      res.type("application/pdf");
      return res.end(row.content, "binary");
    }
    let fp = row?.file_path || null;
    if (!fp) {
      const norm = logical.toLowerCase();
      const files = await fsp.readdir(MAPS_DIR);
      const candidate = files.find((f) =>
        f.toLowerCase().startsWith(`${norm}__`) && f.toLowerCase().endsWith(".pdf")
      );
      if (candidate) fp = path.join(MAPS_DIR, candidate);
    }
    if (!fp || !fs.existsSync(fp)) return res.status(404).send("not_found");
    res.type("application/pdf").sendFile(path.resolve(fp));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Aliases compat pour planFile
app.get("/api/atex/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/atex/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
// -------------------------------------------------
// MAPS — Positions & Subareas (avec auto MAJ fiche équipement)
function pointInRect(px, py, x1, y1, x2, y2) {
  const minx = Math.min(Number(x1), Number(x2));
  const maxx = Math.max(Number(x1), Number(x2));
  const miny = Math.min(Number(y1), Number(y2));
  const maxy = Math.max(Number(y1), Number(y2));
  return px >= minx && px <= maxx && py >= miny && py <= maxy;
}
function pointInCircle(px, py, cx, cy, r) {
  const dx = px - Number(cx), dy = py - Number(cy);
  return dx*dx + dy*dy <= Number(r)*Number(r);
}
function pointInPoly(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i][0]), yi = Number(points[i][1]);
    const xj = Number(points[j][0]), yj = Number(points[j][1]);
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
// Helper surface approximative pour le tri backend
function getArea(z) {
  if (z.kind === "rect") {
    return Math.abs((Number(z.x2) - Number(z.x1)) * (Number(z.y2) - Number(z.y1)));
  }
  if (z.kind === "circle") {
    return Math.PI * (Number(z.r) ** 2);
  }
  if (z.kind === "poly" && Array.isArray(z.points) && z.points.length > 2) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of z.points) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return (maxX - minX) * (maxY - minY);
  }
  return Infinity;
}

async function detectZonesForPoint(logical_name, page_index, x_frac, y_frac) {
  // 1. Récupérer TOUTES les zones de cette page
  const { rows } = await pool.query(
    `SELECT id, kind, x1,y1,x2,y2,cx,cy,r,points,zoning_gas,zoning_dust,name
     FROM atex_subareas WHERE logical_name=$1 AND page_index=$2`,
    [logical_name, page_index]
  );

  // 2. Filtrer celles qui contiennent le point
  const candidates = [];
  for (const z of rows) {
    let inside = false;
    if (z.kind === "rect" && pointInRect(x_frac, y_frac, z.x1, z.y1, z.x2, z.y2)) inside = true;
    else if (z.kind === "circle" && pointInCircle(x_frac, y_frac, z.cx, z.cy, z.r)) inside = true;
    else if (z.kind === "poly" && Array.isArray(z.points) && pointInPoly(x_frac, y_frac, z.points)) inside = true;
    
    if (inside) {
      candidates.push({ ...z, area: getArea(z) });
    }
  }

  // 3. TRI CRITIQUE : La plus PETITE surface gagne (c'est la zone la plus précise)
  candidates.sort((a, b) => a.area - b.area);

  if (candidates.length > 0) {
    const winner = candidates[0]; 
    return { 
      zoning_gas: winner.zoning_gas, 
      zoning_dust: winner.zoning_dust, 
      subarea_id: winner.id, 
      subarea_name: (winner.name || "").trim() || null 
    };
  }

  return { zoning_gas: null, zoning_dust: null, subarea_id: null, subarea_name: null };
}
async function updateEquipmentContext({ equipment_id, logical_name, zoning_gas, zoning_dust, subarea_id, subarea_name_hint }) {
  const planDisplay = await getPlanDisplayName(logical_name);
  const subName = subarea_name_hint || (await getSubareaNameById(subarea_id));
  // MAJ zonage + nom du plan (equipment) + nom de sous-zone (sub_equipment)
  await pool.query(
    `UPDATE atex_equipments
       SET zoning_gas=$1,
           zoning_dust=$2,
           equipment=$3,
           sub_equipment=COALESCE($4, sub_equipment),
           updated_at=now()
     WHERE id=$5`,
    [zoning_gas, zoning_dust, planDisplay, subName || null, equipment_id]
  );
  return { plan_display_name: planDisplay, subarea_name: subName || null };
}
// ✅ VERSION OPTIMISÉE - réponse rapide, détection de zones en arrière-plan
app.put("/api/atex/maps/setPosition", async (req, res) => {
  try {
    const { equipment_id, logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });

    // 1. SUPPRIMER toutes les anciennes positions de cet équipement (permet le déplacement entre plans)
    const deleteResult = await pool.query(`DELETE FROM atex_positions WHERE equipment_id = $1`, [equipment_id]);
    console.log(`[setPosition] DELETE for equipment ${equipment_id}: ${deleteResult.rowCount} rows removed`);

    // 2. Créer la nouvelle position
    await pool.query(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac]
    );
    console.log(`[setPosition] INSERT for equipment ${equipment_id} on plan ${logical_name}`);

    // 3. Répondre IMMÉDIATEMENT au frontend (UX rapide)
    res.json({ ok: true, position_saved: true, deleted_count: deleteResult.rowCount });

    // 3. Mettre à jour le contexte de zone EN ARRIÈRE-PLAN (fire and forget)
    setImmediate(async () => {
      try {
        const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
        await updateEquipmentContext({
          equipment_id,
          logical_name,
          zoning_gas: zones.zoning_gas,
          zoning_dust: zones.zoning_dust,
          subarea_id: zones.subarea_id,
          subarea_name_hint: zones.subarea_name || null,
        });
      } catch (bgErr) {
        console.error('[setPosition background] Error:', bgErr.message);
      }
    });
  } catch (e) {
    console.error('[setPosition] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/atex/maps/setPosition", async (req, res) => {
  req.method = "PUT";
  return app._router.handle(req, res);
});
// ✅ VERSION OPTIMISÉE - réponse rapide, zones en arrière-plan
app.put("/api/atex/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    const { logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });

    // 1. SUPPRIMER toutes les anciennes positions de cet équipement (permet le déplacement entre plans)
    const deleteResult = await pool.query(`DELETE FROM atex_positions WHERE equipment_id = $1`, [equipment_id]);
    console.log(`[setPosition/:id] DELETE for equipment ${equipment_id}: ${deleteResult.rowCount} rows removed`);

    // 2. Créer la nouvelle position
    await pool.query(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac]
    );
    console.log(`[setPosition/:id] INSERT for equipment ${equipment_id} on plan ${logical_name}`);

    // 3. Répondre IMMÉDIATEMENT
    res.json({ ok: true, position_saved: true, deleted_count: deleteResult.rowCount });

    // 3. Mise à jour des zones en arrière-plan
    setImmediate(async () => {
      try {
        const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
        await updateEquipmentContext({
          equipment_id,
          logical_name,
          zoning_gas: zones.zoning_gas,
          zoning_dust: zones.zoning_dust,
          subarea_id: zones.subarea_id,
          subarea_name_hint: zones.subarea_name || null,
        });
      } catch (bgErr) {
        console.error('[positions/:id background] Error:', bgErr.message);
      }
    });
  } catch (e) {
    console.error('[positions/:id] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
// 🔧 Reindex (front l'appelle après modif des sous-zones)
// ✅ VERSION OPTIMISÉE - Batch SQL au lieu de N requêtes séquentielles
app.post("/api/atex/maps/reindexZones", async (req, res) => {
  try {
    const { logical_name, page_index = 0 } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });

    const pageIdx = Number(page_index);

    // 1. Récupérer TOUTES les zones en UNE seule requête
    const { rows: zones } = await pool.query(
      `SELECT id, kind, x1, y1, x2, y2, cx, cy, r, points, zoning_gas, zoning_dust, name
       FROM atex_subareas WHERE logical_name=$1 AND page_index=$2`,
      [logical_name, pageIdx]
    );

    // 2. Récupérer TOUS les équipements positionnés en UNE seule requête
    const { rows: positions } = await pool.query(
      `SELECT equipment_id, x_frac, y_frac FROM atex_positions
       WHERE logical_name=$1 AND page_index=$2`,
      [logical_name, pageIdx]
    );

    if (positions.length === 0) {
      return res.json({ ok: true, updated: 0 });
    }

    // 3. Récupérer le display_name du plan UNE seule fois
    const planDisplay = await getPlanDisplayName(logical_name);

    // 4. Calculer les zones pour chaque position côté serveur (PAS de SQL dans la boucle)
    const updates = [];
    for (const p of positions) {
      const xf = Number(p.x_frac);
      const yf = Number(p.y_frac);

      // Trouve la zone la plus petite qui contient ce point
      const candidates = [];
      for (const z of zones) {
        let inside = false;
        if (z.kind === "rect" && pointInRect(xf, yf, z.x1, z.y1, z.x2, z.y2)) inside = true;
        else if (z.kind === "circle" && pointInCircle(xf, yf, z.cx, z.cy, z.r)) inside = true;
        else if (z.kind === "poly" && Array.isArray(z.points) && pointInPoly(xf, yf, z.points)) inside = true;

        if (inside) {
          candidates.push({ ...z, area: getArea(z) });
        }
      }

      // Tri par surface croissante - la plus petite zone gagne
      candidates.sort((a, b) => a.area - b.area);
      const winner = candidates[0] || null;

      updates.push({
        equipment_id: p.equipment_id,
        zoning_gas: winner?.zoning_gas ?? null,
        zoning_dust: winner?.zoning_dust ?? null,
        subarea_name: (winner?.name || "").trim() || null
      });
    }

    // 5. UPDATE BATCH - UNE seule requête SQL pour tous les équipements
    if (updates.length > 0) {
      const ids = updates.map(u => u.equipment_id);
      const gasArr = updates.map(u => u.zoning_gas);
      const dustArr = updates.map(u => u.zoning_dust);
      const subNames = updates.map(u => u.subarea_name);

      await pool.query(`
        UPDATE atex_equipments e
        SET zoning_gas = u.zoning_gas,
            zoning_dust = u.zoning_dust,
            equipment = $5,
            sub_equipment = COALESCE(u.sub_name, e.sub_equipment),
            updated_at = now()
        FROM (
          SELECT
            unnest($1::uuid[]) as id,
            unnest($2::int[]) as zoning_gas,
            unnest($3::int[]) as zoning_dust,
            unnest($4::text[]) as sub_name
        ) u
        WHERE e.id = u.id
      `, [ids, gasArr, dustArr, subNames, planDisplay]);
    }

    // Log sans bloquer (fire and forget)
    logEvent(req, "zones.reindex", { logical_name, page_index: pageIdx, updated: updates.length }).catch(() => {});

    res.json({ ok: true, updated: updates.length });
  } catch (e) {
    console.error('[reindexZones] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ✅ Positions — accepte id (UUID) OU logical_name
app.get("/api/atex/maps/positions", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        // si "id" n'est pas un UUID, on le traite comme logical_name (compat)
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name or id required" });
    const { rows } = await pool.query(
      `
      SELECT p.equipment_id, p.x_frac, p.y_frac,
             e.name, e.building, e.zone, e.status, e.zoning_gas, e.zoning_dust, e.equipment, e.sub_equipment,
             (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
      FROM atex_positions p
      JOIN atex_equipments e ON e.id=p.equipment_id
      WHERE p.logical_name=$1 AND p.page_index=$2
      `,
      [logical, pageIndex]
    );
    const items = rows.map((r) => {
      // Calculer compliance_state comme dans listEquipments
      const compliance_state =
        r.last_result === "conforme"
          ? "conforme"
          : r.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
      return {
        equipment_id: r.equipment_id,
        name: r.name,
        x_frac: Number(r.x_frac),
        y_frac: Number(r.y_frac),
        status: r.status,
        compliance_state,
        building: r.building,
        zone: r.zone,
        zoning_gas: r.zoning_gas,
        zoning_dust: r.zoning_dust,
        equipment_macro: r.equipment || null,
        sub_equipment: r.sub_equipment || null,
      };
    });
    res.json({ items });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ Position d'un équipement spécifique (pour navigation depuis liste)
app.get("/api/atex/maps/position/:equipmentId", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    if (!equipment_id || !isUuid(equipment_id)) {
      return res.status(400).json({ ok: false, error: "equipment_id invalide" });
    }
    const { rows } = await pool.query(
      `SELECT p.equipment_id, p.logical_name, p.plan_id, p.page_index, p.x_frac, p.y_frac,
              pn.display_name, pl.building, pl.zone
       FROM atex_positions p
       LEFT JOIN atex_plans pl ON pl.logical_name = p.logical_name
       LEFT JOIN atex_plan_names pn ON pn.logical_name = p.logical_name
       WHERE p.equipment_id = $1
       ORDER BY pl.version DESC NULLS LAST
       LIMIT 1`,
      [equipment_id]
    );
    if (rows.length === 0) {
      return res.json({ found: false, position: null });
    }
    const r = rows[0];
    res.json({
      found: true,
      position: {
        equipment_id: r.equipment_id,
        logical_name: r.logical_name,
        plan_id: r.plan_id,
        page_index: r.page_index || 0,
        x_frac: Number(r.x_frac),
        y_frac: Number(r.y_frac),
        display_name: r.display_name || r.logical_name,
        building: r.building,
        zone: r.zone,
      }
    });
  } catch (e) {
    console.error('[getEquipmentPosition] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ✅ Subareas — accepte id (UUID) OU logical_name
app.get("/api/atex/maps/subareas", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    // ASC pour affichage; priorité de sélection gérée en DESC dans detectZonesForPoint
    const { rows } = await pool.query(
      `SELECT * FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 ORDER BY created_at ASC`,
      [logical, pageIndex]
    );
    res.json({ items: rows || [] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.get("/api/atex/maps/subareas/stats", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM atex_subareas WHERE logical_name=$1 AND page_index=$2`,
      [logical, pageIndex]
    );
    res.json({ ok:true, count: rows?.[0]?.n ?? 0 });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post("/api/atex/maps/subareas", async (req, res) => {
  try {
    const {
      kind,
      x1 = null, y1 = null, x2 = null, y2 = null,
      cx = null, cy = null, r = null,
      points = null,
      geometry = null,
      name = "",
      building = "",
      zone = "",
      color = "#6B7280",
      zoning_gas = null, zoning_dust = null,
      logical_name, plan_id = null, page_index = 0,
    } = req.body || {};

    if (!logical_name || !kind) return res.status(400).json({ ok: false, error: "missing params" });
    if (!["rect","circle","poly"].includes(kind)) return res.status(400).json({ ok:false, error:"invalid kind" });

    const planIdSafe = isUuid(plan_id) ? plan_id : null;

    // 1. CRÉATION DE LA ZONE
    const { rows } = await pool.query(
      `INSERT INTO atex_subareas
        (logical_name, plan_id, page_index, kind, x1,y1,x2,y2,cx,cy,r,points,geometry,name,building,zone,color,zoning_gas,zoning_dust)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        logical_name, planIdSafe, page_index, kind,
        x1, y1, x2, y2, cx, cy, r,
        points ? JSON.stringify(points) : null,
        geometry ? JSON.stringify(geometry) : '{}',
        name, building || '', zone || '', color || '#6B7280',
        zoning_gas, zoning_dust,
      ]
    );
    const created = rows[0];
    await pool.query(`UPDATE atex_subareas SET updated_at=now() WHERE id=$1`, [created.id]);
    
    // --- 2. AUTO-LINK : Mettre à jour les équipements déjà présents dans cette zone ---
    try {
      // Récupérer tous les équipements sur cette page du plan
      const { rows: positions } = await pool.query(
        `SELECT equipment_id, x_frac, y_frac FROM atex_positions 
         WHERE logical_name=$1 AND page_index=$2`,
        [logical_name, Number(page_index)]
      );

      const insideIds = [];
      
      // Vérifier quels équipements sont DANS la nouvelle forme
      for (const p of positions) {
        const x = Number(p.x_frac);
        const y = Number(p.y_frac);
        let inside = false;

        if (kind === "rect") inside = pointInRect(x, y, x1, y1, x2, y2);
        else if (kind === "circle") inside = pointInCircle(x, y, cx, cy, r);
        else if (kind === "poly" && Array.isArray(points)) inside = pointInPoly(x, y, points);

        if (inside) {
          insideIds.push(p.equipment_id);
        }
      }

      // Si des équipements sont trouvés, on met à jour leur fiche
      if (insideIds.length > 0) {
        await pool.query(
          `UPDATE atex_equipments
           SET sub_equipment=$1,
               zoning_gas=$2,
               zoning_dust=$3,
               updated_at=now()
           WHERE id = ANY($4::uuid[])`,
          [
            name || "",          // Nom de la sous-zone
            zoning_gas,          // Zone Gaz (ex: 1)
            zoning_dust,         // Zone Poussière (ex: 21)
            insideIds            // Liste des ID concernés
          ]
        );
        console.log(`[ATEX] Auto-link: ${insideIds.length} équipements mis à jour avec la nouvelle zone "${name}"`);
      }
    } catch (err) {
      console.warn("[ATEX] Erreur auto-link (ignored):", err);
    }
    // --------------------------------------------------------------------------------

    await logEvent(req, "subarea.create", { id: created.id, logical_name, page_index, kind, name, zoning_gas, zoning_dust });
    res.json({ ok:true, subarea: created, created: true });

  } catch (e) { 
    res.status(500).json({ ok:false, error:e.message }); 
  }
});
app.put("/api/atex/maps/subareas/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};

    // 0) lire l'état "avant"
    const { rows: beforeRows } = await pool.query(`SELECT * FROM atex_subareas WHERE id=$1`, [id]);
    const before = beforeRows?.[0] || null;
    if (!before) return res.status(404).json({ ok:false, error:"subarea not found" });

    // 1) construire l'UPDATE comme avant
    const set = [];
    const vals = [];
    let i = 1;

    if (body.name !== undefined) { set.push(`name=$${i++}`); vals.push(body.name); }
    if (body.building !== undefined) { set.push(`building=$${i++}`); vals.push(body.building); }
    if (body.zone !== undefined) { set.push(`zone=$${i++}`); vals.push(body.zone); }
    if (body.color !== undefined) { set.push(`color=$${i++}`); vals.push(body.color); }
    if (body.zoning_gas !== undefined) { set.push(`zoning_gas=$${i++}`); vals.push(body.zoning_gas); }
    if (body.zoning_dust !== undefined) { set.push(`zoning_dust=$${i++}`); vals.push(body.zoning_dust); }
    if (body.kind) {
      if (!["rect","circle","poly"].includes(body.kind)) return res.status(400).json({ ok:false, error:"invalid kind" });
      set.push(`kind=$${i++}`); vals.push(body.kind);
    }
    const geoKeys = ["x1","y1","x2","y2","cx","cy","r"];
    for (const k of geoKeys) {
      if (body[k] !== undefined) { set.push(`${k}=$${i++}`); vals.push(body[k]); }
    }
    if (body.points !== undefined) {
      set.push(`points=$${i++}`); vals.push(body.points ? JSON.stringify(body.points) : null);
    }
    if (body.geometry !== undefined) {
      set.push(`geometry=$${i++}`); vals.push(body.geometry ? JSON.stringify(body.geometry) : '{}');
    }

    if (!set.length) {
      // rien à modifier → on sort tôt
      return res.json({ ok: true });
    }

    set.push(`updated_at=now()`);
    vals.push(id);

    await pool.query(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals);
    await logEvent(req, "subarea.update", { id });

    // 2) si le nom change → propager aux équipements contenus dans cette forme
    const nameChanged = body.name !== undefined && String(body.name || "").trim() !== String(before.name || "").trim();

    if (nameChanged) {
      // relire "après" (géométrie possiblement mise à jour)
      const { rows: afterRows } = await pool.query(`SELECT * FROM atex_subareas WHERE id=$1`, [id]);
      const sub = afterRows?.[0] || null;
      if (sub) {
        // lister les positions du même plan / page
        const { rows: pos } = await pool.query(
          `SELECT equipment_id, x_frac, y_frac FROM atex_positions WHERE logical_name=$1 AND page_index=$2`,
          [sub.logical_name, Number(sub.page_index || 0)]
        );

        // pour chaque position, tester l'appartenance à la forme
        const insideEquipIds = [];
        for (const p of pos) {
          const x = Number(p.x_frac), y = Number(p.y_frac);
          let inside = false;
          if (sub.kind === "rect") inside = pointInRect(x, y, sub.x1, sub.y1, sub.x2, sub.y2);
          else if (sub.kind === "circle") inside = pointInCircle(x, y, sub.cx, sub.cy, sub.r);
          else if (sub.kind === "poly" && Array.isArray(sub.points)) inside = pointInPoly(x, y, sub.points);
          if (inside) insideEquipIds.push(p.equipment_id);
        }

        if (insideEquipIds.length) {
          await pool.query(
            `UPDATE atex_equipments SET sub_equipment=$1, updated_at=now() WHERE id = ANY($2::uuid[])`,
            [String(sub.name || "").trim() || null, insideEquipIds]
          );
          await logEvent(req, "subarea.rename.cascade", {
            id, count: insideEquipIds.length, new_name: sub.name || null
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
app.put("/api/atex/maps/subareas/:id/geometry", async (req, res) => {
  try {
    const id = String(req.params.id);
    const {
      kind = null,
      x1 = null, y1 = null, x2 = null, y2 = null,
      cx = null, cy = null, r = null,
      points = null,
    } = req.body || {};
    if (kind && !["rect","circle","poly"].includes(kind))
      return res.status(400).json({ ok:false, error:"invalid kind" });
    const set = [];
    const vals = [];
    let i = 1;
    if (kind) { set.push(`kind=$${i++}`); vals.push(kind); }
    for (const [k, v] of Object.entries({ x1,y1,x2,y2,cx,cy,r })) {
      if (v !== undefined) { set.push(`${k}=$${i++}`); vals.push(v); }
    }
    if (points !== undefined) {
      set.push(`points=$${i++}`); vals.push(points ? JSON.stringify(points) : null);
    }
    set.push(`updated_at=now()`);
    vals.push(id);
    await pool.query(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals);
    await logEvent(req, "subarea.update.geometry", { id, kind, hasPoints: Array.isArray(points) ? points.length : null });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.delete("/api/atex/maps/subareas/:id", async (req, res) => {
  try { const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_subareas WHERE id=$1`, [id]);
    await logEvent(req, "subarea.delete", { id });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ purge — accepte id OU logical_name
app.delete("/api/atex/maps/subareas/purge", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    if ((req.header("X-Confirm") || "").toLowerCase() !== "purge")
      return res.status(412).json({ ok:false, error:"missing confirmation header X-Confirm: purge" });
    const { rows } = await pool.query(
      `DELETE FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 RETURNING id`,
      [logical, pageIndex]
    );
    await logEvent(req, "subarea.purge", { logical_name: logical, page_index: pageIndex, deleted: rows.length });
    res.json({ ok:true, deleted: rows.length });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// -------------------------------------------------
// MAPS META — building / zone persistants par plan
// -------------------------------------------------
app.get("/api/atex/maps/meta", async (req, res) => {
  try {
    const plan_key = (req.query.plan_key || "").toString().trim();
    if (!plan_key) return res.status(400).json({ error: "plan_key requis" });
    const { rows } = await pool.query(
      `SELECT id, logical_name, building, zone
         FROM atex_plans
        WHERE id::text = $1 OR logical_name = $1
        ORDER BY version DESC LIMIT 1`,
      [plan_key]
    );
    if (!rows.length) return res.status(404).json({ error: "Plan introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error("getMeta error", e);
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/atex/maps/meta", async (req, res) => {
  try {
    const { plan_key, building = null, zone = null } = req.body || {};
    if (!plan_key) return res.status(400).json({ error: "plan_key requis" });
    
    // Cherche le plan par UUID ou logical_name
    const { rows: found } = await pool.query(
      `SELECT id, logical_name FROM atex_plans
       WHERE id::text = $1 OR logical_name = $1
       ORDER BY version DESC LIMIT 1`,
      [plan_key]
    );
    const plan = found?.[0];
    if (!plan) return res.status(404).json({ error: "Plan introuvable" });
    
    // Mise à jour du plan (comme avant)
    await pool.query(
      `UPDATE atex_plans SET building=$1, zone=$2 WHERE id=$3`,
      [building, zone, plan.id]
    );
    
    // NOUVEAU : Propagation aux équipements liés via positions (seulement pour ce plan)
    // Utilise logical_name pour cibler précisément
    await pool.query(`
      UPDATE atex_equipments e
      SET building = COALESCE($1, e.building),  -- Met à jour seulement si fourni (sinon garde l'ancien)
          zone = COALESCE($2, e.zone),          -- Idem pour zone
          updated_at = now()
      FROM atex_positions p
      WHERE p.equipment_id = e.id AND p.logical_name = $3
    `, [building, zone, plan.logical_name]);
    
    // Log l'événement (comme ailleurs dans le code)
    await logEvent(req, "plans.meta.update", { plan_key, building, zone, propagated: true });
    
    res.json({ ok: true, plan_id: plan.id, building, zone });
  } catch (e) {
    console.error("setMeta error", e);
    res.status(500).json({ error: e.message });
  }
});
// -------------------------------------------------
// Bulk rename (building / zone / equipment / sub_equipment)
// -------------------------------------------------
app.post("/api/atex/bulk/rename", async (req, res) => {
  try {
    const { field, from, to } = req.body || {};
    const allowed = new Set(["building","zone","equipment","sub_equipment"]);
    if (!allowed.has(field)) return res.status(400).json({ ok:false, error:"invalid field" });

    const fromS = String(from || "").trim();
    const toS = String(to || "").trim();
    if (!fromS) return res.status(400).json({ ok:false, error:"missing 'from'" });

    const q = `UPDATE atex_equipments SET ${field}=$1, updated_at=now() WHERE ${field}=$2`;
    const { rowCount } = await pool.query(q, [toS || null, fromS]);
    await logEvent(req, "equipments.bulk.rename", { field, from: fromS, to: toS || null, count: rowCount });
    res.json({ ok:true, updated: rowCount });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
// -------------------------------------------------
// Logs
app.get("/api/atex/logs", async (req, res) => {
  try {
    const action = (req.query.action || "").toString().trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    let rows;
    if (action) {
      ({ rows } = await pool.query(
        `SELECT * FROM atex_events WHERE action=$1 ORDER BY ts DESC LIMIT $2`,
        [action, limit]
      ));
    } else {
      ({ rows } = await pool.query(`SELECT * FROM atex_events ORDER BY ts DESC LIMIT $1`, [limit]));
    }
    res.json({ items: rows || [] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// =====================================================================
// IA — helpers (à placer juste AVANT le bloc  // ------------------------------------------------- // IA)
// =====================================================================
async function atexExtractFromFiles(client, files) {
  if (!client) throw new Error("OPENAI_API_KEY missing");
  if (!files?.length) throw new Error("no files");

  const images = await Promise.all(
    files.map(async (f) => ({
      name: f.originalname,
      mime: f.mimetype,
      data: (await fsp.readFile(f.path)).toString("base64"),
    }))
  );

  const sys = `Tu es un assistant d'inspection ATEX. Extrait des photos:
- manufacturer
- manufacturer_ref
- atex_mark_gas
- atex_mark_dust
- type
Réponds en JSON strict.`;

  const content = [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        { type: "text", text: "Analyse ces photos et renvoie uniquement un JSON." },
        ...images.map((im) => ({
          type: "image_url",
          image_url: { url: `data:${im.mime};base64,${im.data}` },
        })),
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
    messages: content,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  let data = {};
  try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }
  return {
    manufacturer: String(data.manufacturer || ""),
    manufacturer_ref: String(data.manufacturer_ref || ""),
    atex_mark_gas: String(data.atex_mark_gas || ""),
    atex_mark_dust: String(data.atex_mark_dust || ""),
    type: String(data.type || ""),
  };
}
// -------------------------------------------------
// IA
function openaiClient() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ATEX || process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}
// ✅ Nouvelle route robuste : multi-photos natif
app.post("/api/atex/analyzePhotoBatch", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    const extracted = await atexExtractFromFiles(client, req.files || []);
    res.json({ ok: true, extracted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/atex/extract", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    const extracted = await atexExtractFromFiles(client, req.files || []);
    res.json({ ok: true, extracted });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
function localAtexCompliance(atex_mark_gas, atex_mark_dust, target_gas, target_dust) {
  const result = { decision: "indetermine", rationale: "" };

  function parseCategory(mark, type) {
    if (!mark) return null;
    const m = mark.match(/II\s*(\d)\s*[GD]/i);
    if (!m) return null;
    const cat = parseInt(m[1]);
    const zones =
      type === "gas"
        ? cat === 1 ? [0,1,2] : cat === 2 ? [1,2] : cat === 3 ? [2] : []
        : cat === 1 ? [20,21,22] : cat === 2 ? [21,22] : cat === 3 ? [22] : [];
    return { cat, zones };
  }

  const g = parseCategory(atex_mark_gas, "gas");
  const d = parseCategory(atex_mark_dust, "dust");

  let gasOk = null, dustOk = null;
  let rationale_parts = [];

  // Si une zone gaz est définie, un marquage gaz valide est OBLIGATOIRE
  if (target_gas != null) {
    if (g) {
      gasOk = g.zones.includes(Number(target_gas));
      if (!gasOk) {
        rationale_parts.push(`Marquage gaz (Cat ${g.cat}G) insuffisant pour zone ${target_gas}`);
      }
    } else {
      // Pas de marquage gaz valide pour une zone gaz → non conforme
      gasOk = false;
      rationale_parts.push(`Marquage gaz requis pour zone ${target_gas} mais absent ou invalide`);
    }
  }

  // Si une zone poussière est définie, un marquage poussière valide est OBLIGATOIRE
  if (target_dust != null) {
    if (d) {
      dustOk = d.zones.includes(Number(target_dust));
      if (!dustOk) {
        rationale_parts.push(`Marquage poussière (Cat ${d.cat}D) insuffisant pour zone ${target_dust}`);
      }
    } else {
      // Pas de marquage poussière valide pour une zone poussière → non conforme
      dustOk = false;
      rationale_parts.push(`Marquage poussière requis pour zone ${target_dust} mais absent ou invalide`);
    }
  }

  if ((gasOk === true || gasOk === null) && (dustOk === true || dustOk === null)) {
    result.decision = "conforme";
    result.rationale = "Le marquage couvre les zones cibles (norme 2014/34/UE).";
  } else if (gasOk === false || dustOk === false) {
    result.decision = "non_conforme";
    result.rationale = rationale_parts.length > 0
      ? rationale_parts.join(". ") + "."
      : "Le marquage ne couvre pas les zones cibles.";
  } else {
    result.decision = "indetermine";
    result.rationale = "Impossible de déterminer à partir du marquage fourni.";
  }

  return result;
}
app.post("/api/atex/assess", async (req, res) => {
  try {
    const client = openaiClient();
    const { atex_mark_gas = "", atex_mark_dust = "", target_gas = null, target_dust = null } = req.body || {};

    // ✅ Étape 1 : logique locale fiable
    const local = localAtexCompliance(atex_mark_gas, atex_mark_dust, target_gas, target_dust);
    if (local.decision !== "indetermine") {
      // Si la règle est claire selon la directive ATEX → on ne demande pas à l'IA
      return res.json({ ok: true, ...local, source: "local" });
    }

    // ✅ Étape 2 : fallback IA seulement si marquage incomplet ou douteux
    if (!client) return res.status(501).json({ ok: false, error: "OPENAI_API_KEY missing" });

    const sys = `Tu es expert ATEX. Retourne {"decision":"conforme|non_conforme|indetermine","rationale":"..."} en JSON strict.
Rappelle-toi :
- Catégorie 1G/D → zones 0,1,2 (ou 20,21,22)
- Catégorie 2G/D → zones 1,2 (ou 21,22)
- Catégorie 3G/D → zones 2 (ou 22)
`;

    const messages = [
      { role: "system", content: sys },
      {
        role: "user",
        content:
          `Marquage gaz: ${atex_mark_gas || "(aucun)"}\n` +
          `Marquage poussière: ${atex_mark_dust || "(aucun)"}\n` +
          `Zonage cible gaz: ${target_gas}\n` +
          `Zonage cible poussière: ${target_dust}`,
      },
    ];

    const resp = await client.chat.completions.create({
      model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    let data = {};
    try {
      data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    } catch {
      data = {};
    }

    // ✅ Étape 3 : envoie la réponse finale
    res.json({ ok: true, ...data, source: "openai" });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ✅ Endpoint dédié pour "appliquer" la conformité IA à une fiche (sans toucher à l'échéance)
app.post("/api/atex/equipments/:id/compliance", async (req, res) => {
  try {
    const id = String(req.params.id);
    // ✅ inclure `source` ici
    const { decision = null, rationale = "", source = null } = req.body || {};
    if (!["conforme", "non_conforme", "indetermine", null].includes(decision))
      return res.status(400).json({ ok:false, error:"invalid decision" });

    const u = getUser(req);

    // ✅ insertion avec details contenant la source
    const { rows } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, date, items, result, user_name, user_email, files, details)
       VALUES($1,'fait',now(),$2,$3,$4,$5,'[]'::jsonb,$6)
       RETURNING *`,
      [
        id,
        JSON.stringify([{ label: "Vérification IA", value: decision, rationale }]),
        decision === "indetermine" ? null : decision,
        u.name || "",
        u.email || "",
        { source: source || "unknown" }, // ✅ plus d'erreur ici
      ]
    );

    // ✅ retour équipement mis à jour
    const { rows: eqR } = await pool.query(
      `SELECT e.*,
              (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
         FROM atex_equipments e WHERE e.id=$1`,
      [id]
    );
    const eq = eqR?.[0] || null;
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.compliance_state =
        eq.last_result === "conforme"
          ? "conforme"
          : eq.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
    }

    res.json({ ok: true, check: rows[0], equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Legacy aliases (compat)
app.post("/api/atex/aiAnalyze", (req, res) => {
  req.url = "/api/atex/assess";
  return app._router.handle(req, res);
});

// ============================================================
// AUDIT TRAIL - Historique des modifications
// ============================================================

// GET /audit/history - Récupérer l'historique complet
app.get("/api/atex/audit/history", async (req, res) => {
  try {
    const { limit = 100, offset = 0, action } = req.query;

    let query = `
      SELECT id, ts, action, actor_name, actor_email, details
      FROM atex_events
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (action) {
      query += ` AND action = $${paramIdx++}`;
      params.push(action);
    }

    query += ` ORDER BY ts DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(query, params);

    // Transformer pour compatibilité avec le composant frontend
    const events = rows.map(r => ({
      ...r,
      entity_type: r.details?.entity_type || 'equipment',
      entity_id: r.details?.id || r.details?.equipmentId || null,
    }));

    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/equipment/:id - Historique d'un équipement spécifique
app.get("/api/atex/audit/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    const { rows } = await pool.query(`
      SELECT id, ts, action, actor_name, actor_email, details
      FROM atex_events
      WHERE details->>'id' = $1 OR details->>'equipmentId' = $1
      ORDER BY ts DESC
      LIMIT $2
    `, [id, parseInt(limit)]);

    const events = rows.map(r => ({
      ...r,
      entity_type: 'equipment',
      entity_id: id,
    }));

    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/stats - Statistiques d'audit
app.get("/api/atex/audit/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const { rows } = await pool.query(`
      SELECT
        action,
        COUNT(*) as count,
        COUNT(DISTINCT actor_email) as unique_actors,
        MAX(ts) as last_occurrence
      FROM atex_events
      WHERE ts >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY action
      ORDER BY count DESC
    `);

    const { rows: contributors } = await pool.query(`
      SELECT
        actor_email,
        actor_name,
        COUNT(*) as action_count
      FROM atex_events
      WHERE ts >= NOW() - INTERVAL '${parseInt(days)} days'
        AND actor_email IS NOT NULL
      GROUP BY actor_email, actor_name
      ORDER BY action_count DESC
      LIMIT 10
    `);

    res.json({
      by_action: rows,
      top_contributors: contributors
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🔌 INFRASTRUCTURE ENDPOINTS (Plans électriques multi-zones)
// Routes: /api/infra/*
// ============================================================

const INFRA_DIR = path.join(DATA_DIR, "infra");
await fsp.mkdir(INFRA_DIR, { recursive: true });

const multerInfraPlan = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Health check
app.get("/api/infra/health", (req, res) => {
  res.json({ status: "ok", service: "infrastructure", ts: new Date().toISOString() });
});

// ========================= PLANS =========================

// List plans
app.get("/api/infra/plans", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const filter = getTenantFilter(tenant, "infrastructure_plans");

    const { rows } = await pool.query(`
      SELECT id, logical_name, display_name, building_name, filename, page_count, created_at, updated_at
      FROM infrastructure_plans
      WHERE ${filter.where}
      ORDER BY building_name, display_name, created_at DESC
    `, filter.params);

    res.json({ plans: rows });
  } catch (e) {
    console.error("[infra] list plans error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Upload plan
app.post("/api/infra/plans", multerInfraPlan.single("file"), async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const building_name = req.body.building_name || "";
    const originalName = file.originalname || "plan.pdf";
    const logical_name = originalName.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_");
    const display_name = originalName.replace(/\.[^.]+$/, "");

    const { rows } = await pool.query(`
      INSERT INTO infrastructure_plans (logical_name, display_name, building_name, filename, content, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, logical_name, display_name, building_name, filename, created_at
    `, [logical_name, display_name, building_name, originalName, file.buffer, tenant.companyId, tenant.siteId]);

    res.json({ plan: rows[0] });
  } catch (e) {
    console.error("[infra] upload plan error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Get plan file
app.get("/api/infra/plans/:id/file", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT content, filename FROM infrastructure_plans WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0] || !rows[0].content) return res.status(404).json({ error: "Plan not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(rows[0].content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete plan
app.delete("/api/infra/plans/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM infrastructure_plans WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================= ZONES =========================

// List zones
app.get("/api/infra/zones", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const filter = getTenantFilter(tenant, "infrastructure_zones");
    const plan_id = req.query.plan_id;

    let query = `SELECT * FROM infrastructure_zones WHERE ${filter.where}`;
    let params = [...filter.params];

    if (plan_id) {
      query += ` AND plan_id = $${params.length + 1}`;
      params.push(plan_id);
    }

    query += ` ORDER BY name`;
    const { rows } = await pool.query(query, params);
    res.json({ zones: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create zone
app.post("/api/infra/zones", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const { plan_id, name, kind, geometry, color, page_index, linked_atex_plans, zoning_gas, zoning_dust } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO infrastructure_zones (plan_id, name, kind, geometry, color, page_index, linked_atex_plans, zoning_gas, zoning_dust, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      plan_id,
      name || "",
      kind || "rect",
      JSON.stringify(geometry || {}),
      color || "#6B7280",
      page_index || 0,
      JSON.stringify(linked_atex_plans || []),
      zoning_gas ?? null,
      zoning_dust ?? null,
      tenant.companyId,
      tenant.siteId
    ]);

    res.json({ zone: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update zone
app.put("/api/infra/zones/:id", async (req, res) => {
  try {
    const { name, kind, geometry, color, linked_atex_plans, zoning_gas, zoning_dust } = req.body;
    const { rows } = await pool.query(`
      UPDATE infrastructure_zones
      SET name = COALESCE($2, name),
          kind = COALESCE($3, kind),
          geometry = COALESCE($4, geometry),
          color = COALESCE($5, color),
          linked_atex_plans = COALESCE($6, linked_atex_plans),
          zoning_gas = COALESCE($7, zoning_gas),
          zoning_dust = COALESCE($8, zoning_dust)
      WHERE id = $1
      RETURNING *
    `, [
      req.params.id,
      name,
      kind,
      geometry ? JSON.stringify(geometry) : null,
      color,
      linked_atex_plans ? JSON.stringify(linked_atex_plans) : null,
      zoning_gas,
      zoning_dust
    ]);

    res.json({ zone: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete zone
app.delete("/api/infra/zones/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM infrastructure_zones WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================= POSITIONS (équipements ATEX sur plans infra) =========================

// List positions
app.get("/api/infra/positions", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    // Filter on equipment (e) instead of position to ensure we see all positions for visible equipments
    const filter = getTenantFilter(tenant, { tableAlias: 'e' });
    const plan_id = req.query.plan_id;

    let query = `
      SELECT p.*, e.name as equipment_name, e.type as equipment_type, e.building, e.zone,
             e.status as equipment_status, e.zoning_gas, e.zoning_dust, e.photo_url as equipment_photo
      FROM infrastructure_positions p
      JOIN atex_equipments e ON p.equipment_id = e.id
      WHERE ${filter.where}
    `;
    let params = [...filter.params];

    if (plan_id) {
      query += ` AND p.plan_id = $${params.length + 1}`;
      params.push(plan_id);
    }

    console.log("[INFRA] GET /api/infra/positions filter:", { where: filter.where, params, plan_id });
    const { rows } = await pool.query(query, params);
    console.log("[INFRA] GET /api/infra/positions returned:", rows.length, "positions");
    res.json({ positions: rows });
  } catch (e) {
    console.error("[INFRA] GET /api/infra/positions error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Create/update position
app.post("/api/infra/positions", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const { equipment_id, plan_id, zone_id, page_index, x_frac, y_frac } = req.body;

    console.log("[INFRA] POST /api/infra/positions:", { equipment_id, plan_id, zone_id, page_index, x_frac, y_frac, tenant: { companyId: tenant.companyId, siteId: tenant.siteId } });

    // Upsert: si position existe déjà, update
    const { rows } = await pool.query(`
      INSERT INTO infrastructure_positions (equipment_id, plan_id, zone_id, page_index, x_frac, y_frac, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (equipment_id, plan_id, page_index)
      DO UPDATE SET x_frac = $5, y_frac = $6, zone_id = $3
      RETURNING *
    `, [equipment_id, plan_id, zone_id || null, page_index || 0, x_frac, y_frac, tenant.companyId, tenant.siteId]);

    console.log("[INFRA] Position created/updated:", rows[0]);
    res.json({ position: rows[0] });
  } catch (e) {
    console.error("[INFRA] POST /api/infra/positions error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Update position
app.put("/api/infra/positions/:id", async (req, res) => {
  try {
    const { x_frac, y_frac, zone_id } = req.body;
    const { rows } = await pool.query(`
      UPDATE infrastructure_positions
      SET x_frac = COALESCE($2, x_frac), y_frac = COALESCE($3, y_frac), zone_id = COALESCE($4, zone_id)
      WHERE id = $1
      RETURNING *
    `, [req.params.id, x_frac, y_frac, zone_id]);

    res.json({ position: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete position
app.delete("/api/infra/positions/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM infrastructure_positions WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================= STATS & ELEMENT TYPES (pour compatibilité frontend) =========================

app.get("/api/infra/stats", async (req, res) => {
  try {
    const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
    const filter = getTenantFilter(tenant, "infrastructure_plans");

    const plansRes = await pool.query(`SELECT COUNT(*) as count FROM infrastructure_plans WHERE ${filter.where}`, filter.params);
    const zonesRes = await pool.query(`SELECT COUNT(*) as count FROM infrastructure_zones WHERE ${getTenantFilter(tenant).where}`, getTenantFilter(tenant).params);
    const posRes = await pool.query(`SELECT COUNT(*) as count FROM infrastructure_positions WHERE ${getTenantFilter(tenant).where}`, getTenantFilter(tenant).params);

    res.json({
      plans: parseInt(plansRes.rows[0]?.count || 0),
      zones: parseInt(zonesRes.rows[0]?.count || 0),
      positions: parseInt(posRes.rows[0]?.count || 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dummy element-types endpoint for compatibility (infrastructure uses ATEX equipment types)
app.get("/api/infra/element-types", async (req, res) => {
  try {
    // Retourne les types d'équipements ATEX existants
    const { rows } = await pool.query(`SELECT DISTINCT type FROM atex_equipments WHERE type IS NOT NULL AND type != '' ORDER BY type`);
    res.json({ types: rows.map(r => r.type) });
  } catch (e) {
    res.status(500).json({ error: e.message, types: [] });
  }
});

// Dummy elements endpoint - positions are now used instead
app.get("/api/infra/elements", async (req, res) => {
  res.json({ elements: [], message: "Use /api/infra/positions instead" });
});

// ============================================================
// GENERATION DU DRPCE (Document Relatif a la Protection Contre les Explosions)
// Renomme: Management Monitoring Report
// ============================================================
app.get("/api/atex/drpce", async (req, res) => {
  try {
    // 0. Récupérer les paramètres de filtrage
    const siteName = req.query.site;
    const filterBuilding = req.query.building || null;
    const filterZone = req.query.zone || null;
    const filterCompliance = req.query.compliance || null; // conforme, non_conforme, na

    let siteId = null;
    let companyId = null;

    if (siteName) {
      try {
        const siteRes = await pool.query(
          `SELECT id, company_id FROM sites WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [siteName]
        );
        if (siteRes.rows[0]) {
          siteId = siteRes.rows[0].id;
          companyId = siteRes.rows[0].company_id;
          console.log(`[DRPCE] Found site: ${siteName} -> site_id=${siteId}, company_id=${companyId}`);
        }
      } catch (e) {
        console.warn('[DRPCE] Site lookup failed:', e.message);
      }
    }

    // Fallback sur tenant depuis headers si pas de query param
    if (!siteId) {
      const tenant = await enrichTenantWithSiteId(extractTenantFromRequest(req), req, pool);
      siteId = tenant.siteId;
      companyId = tenant.companyId;
    }

    // 1. Récupérer les informations du site depuis site_settings (avec logo)
    let siteInfo = { company_name: "Entreprise", site_name: siteName || "Site", logo: null, logo_mime: null };
    try {
      const siteRes = await pool.query(
        `SELECT company_name, company_address, company_phone, company_email, logo, logo_mime
         FROM site_settings WHERE site = $1`,
        [siteName || 'default']
      );
      if (siteRes.rows[0]) {
        siteInfo = {
          ...siteInfo,
          ...siteRes.rows[0],
          site_name: siteName || siteRes.rows[0].company_name || "Site"
        };
      }
    } catch (e) { console.warn('[DRPCE] No site settings:', e.message); }

    // 2. Récupérer tous les équipements ATEX avec filtres
    let equipmentQuery = `
      SELECT e.id, e.name, e.type, e.building, e.zone, e.manufacturer, e.manufacturer_ref,
             e.equipment, e.sub_equipment, e.atex_mark_gas, e.atex_mark_dust,
             e.zoning_gas, e.zoning_dust, e.next_check_date, e.photo_content, e.photo_path,
             e.site_id, e.company_id,
             (SELECT result FROM atex_checks c
              WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
              ORDER BY c.date DESC NULLS LAST LIMIT 1) AS last_result,
             (SELECT date FROM atex_checks c
              WHERE c.equipment_id=e.id AND c.status='fait'
              ORDER BY c.date DESC NULLS LAST LIMIT 1) AS last_check_date
      FROM atex_equipments e
      WHERE 1=1
    `;
    let equipmentParams = [];
    let paramIndex = 1;

    if (siteId) {
      equipmentQuery += ` AND e.site_id = $${paramIndex}`;
      equipmentParams.push(siteId);
      paramIndex++;
    } else if (companyId) {
      equipmentQuery += ` AND e.company_id = $${paramIndex}`;
      equipmentParams.push(companyId);
      paramIndex++;
    }

    if (filterBuilding) {
      equipmentQuery += ` AND e.building = $${paramIndex}`;
      equipmentParams.push(filterBuilding);
      paramIndex++;
    }

    if (filterZone) {
      equipmentQuery += ` AND e.zone = $${paramIndex}`;
      equipmentParams.push(filterZone);
      paramIndex++;
    }

    equipmentQuery += ` ORDER BY e.building, e.zone, e.name`;

    let { rows: equipments } = await pool.query(equipmentQuery, equipmentParams);

    // Filtrer par compliance si demandé (doit être fait après car c'est une sous-requête)
    if (filterCompliance) {
      equipments = equipments.filter(e => {
        if (filterCompliance === 'conforme') return e.last_result === 'conforme';
        if (filterCompliance === 'non_conforme') return e.last_result === 'non_conforme';
        if (filterCompliance === 'na') return !e.last_result || e.last_result === 'na';
        return true;
      });
    }

    console.log(`[DRPCE] Found ${equipments.length} equipments (filters: building=${filterBuilding}, zone=${filterZone}, compliance=${filterCompliance})`);

    // 2b. Récupérer les positions des équipements sur les plans (avec thumbnails pré-générés)
    const equipmentIds = equipments.map(e => e.id);
    let positionsMap = new Map();
    if (equipmentIds.length > 0) {
      // Requête améliorée: récupère le thumbnail pré-généré, sinon le content (PDF)
      const { rows: positions } = await pool.query(`
        SELECT pos.equipment_id, pos.logical_name, pos.plan_id, pos.x_frac, pos.y_frac,
               COALESCE(p_by_logical.thumbnail, p_by_id.thumbnail) AS plan_thumbnail,
               COALESCE(p_by_logical.content, p_by_id.content) AS plan_content,
               COALESCE(pn.display_name, pos.logical_name, 'Plan') AS plan_display_name
        FROM atex_positions pos
        LEFT JOIN (
          SELECT DISTINCT ON (logical_name) id, logical_name, content, thumbnail
          FROM atex_plans
          ORDER BY logical_name, version DESC
        ) p_by_logical ON p_by_logical.logical_name = pos.logical_name
        LEFT JOIN atex_plans p_by_id ON p_by_id.id = pos.plan_id
        LEFT JOIN atex_plan_names pn ON pn.logical_name = COALESCE(pos.logical_name, p_by_id.logical_name)
        WHERE pos.equipment_id = ANY($1)
      `, [equipmentIds]);

      // Map positions by equipment_id (prendre la première position si plusieurs)
      for (const pos of positions) {
        if (!positionsMap.has(pos.equipment_id)) {
          positionsMap.set(pos.equipment_id, pos);
        }
      }
      console.log(`[DRPCE] Found ${positions.length} equipment positions on plans`);
      // Debug: afficher les détails des positions trouvées
      if (positions.length > 0) {
        const withThumbnail = positions.filter(p => p.plan_thumbnail && p.plan_thumbnail.length > 0).length;
        const withContent = positions.filter(p => p.plan_content && p.plan_content.length > 0).length;
        console.log(`[DRPCE] Positions with thumbnail: ${withThumbnail}/${positions.length}, with content: ${withContent}/${positions.length}`);
      }
    }

    // 3. Récupérer les plans avec leurs images (pour la liste uniquement, plus d'affichage d'images)
    const { rows: plans } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id, p.logical_name, p.building, p.zone, p.is_multi_zone, p.building_name,
             COALESCE(pn.display_name, p.logical_name) AS display_name
      FROM atex_plans p
      LEFT JOIN atex_plan_names pn ON pn.logical_name = p.logical_name
      ORDER BY p.logical_name, p.version DESC
    `);

    // 4. Récupérer les sous-zones ATEX
    const { rows: subareas } = await pool.query(`
      SELECT * FROM atex_subareas ORDER BY logical_name, name
    `);

    // 5. Statistiques
    const totalEquipments = equipments.length;
    const conformeCount = equipments.filter(e => e.last_result === 'conforme').length;
    const nonConformeCount = equipments.filter(e => e.last_result === 'non_conforme').length;
    const naCount = totalEquipments - conformeCount - nonConformeCount;
    const retardCount = equipments.filter(e => {
      if (!e.next_check_date) return false;
      return new Date(e.next_check_date) < new Date();
    }).length;

    // Grouper par bâtiment/zone
    const byBuilding = {};
    for (const eq of equipments) {
      const bat = eq.building || 'Non renseigne';
      const z = eq.zone || 'Non renseignee';
      if (!byBuilding[bat]) byBuilding[bat] = {};
      if (!byBuilding[bat][z]) byBuilding[bat][z] = [];
      byBuilding[bat][z].push(eq);
    }

    // 6. Créer le PDF avec couleurs Haleon
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: {
        Title: 'Management Monitoring - ATEX Equipment Report',
        Author: siteInfo.company_name,
        Subject: 'ATEX Installation Management Report',
        Keywords: 'ATEX, management, monitoring, explosions, safety'
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Management_Monitoring_${(siteInfo.site_name || 'site').replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // Couleurs Haleon (vert/teal)
    const colors = {
      primary: '#00857C',    // Haleon Teal
      secondary: '#1e40af',  // Blue
      success: '#00857C',    // Haleon Teal
      danger: '#dc2626',     // Red
      warning: '#d97706',    // Amber
      text: '#111827',       // Gray-900
      muted: '#6b7280',      // Gray-500
      light: '#f3f4f6',      // Gray-100
      accent: '#4ade80',     // Light green
    };

    // ========== PAGE DE GARDE ==========
    doc.rect(0, 0, 595, 842).fill('#f0fdfa'); // Fond vert très clair

    // Bandeau supérieur Haleon
    doc.rect(0, 0, 595, 120).fill(colors.primary);

    // Logo si disponible (depuis site_settings)
    let contentStartY = 140;
    if (siteInfo.logo && siteInfo.logo.length > 0) {
      try {
        doc.image(siteInfo.logo, 50, 25, { height: 70 });
      } catch (e) {
        console.warn('[DRPCE] Logo error:', e.message);
      }
    }

    // Titre dans le bandeau
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#fff')
       .text('Management Monitoring', 200, 35, { width: 350, align: 'right' });
    doc.fontSize(12).font('Helvetica').fillColor('#fff')
       .text('ATEX Equipment Report', 200, 70, { width: 350, align: 'right' });

    // Infos entreprise
    doc.fontSize(24).font('Helvetica-Bold').fillColor(colors.primary)
       .text(siteInfo.company_name || 'Entreprise', 50, contentStartY + 30, { align: 'center', width: 495 });

    if (siteInfo.company_address) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted)
         .text(siteInfo.company_address, 50, contentStartY + 65, { align: 'center', width: 495 });
    }

    // Site
    doc.fontSize(16).font('Helvetica').fillColor(colors.text)
       .text(`Site: ${siteInfo.site_name || siteName || 'Non renseigne'}`, 50, contentStartY + 100, { align: 'center', width: 495 });

    // Filtres appliqués
    let filterText = '';
    if (filterBuilding) filterText += `Batiment: ${filterBuilding}  `;
    if (filterZone) filterText += `Zone: ${filterZone}  `;
    if (filterCompliance) filterText += `Conformite: ${filterCompliance}`;
    if (filterText) {
      doc.fontSize(10).fillColor(colors.muted)
         .text(`Filtres: ${filterText}`, 50, contentStartY + 125, { align: 'center', width: 495 });
    }

    // Date
    doc.fontSize(10).fillColor(colors.muted)
       .text(`Document genere le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, contentStartY + 150, { align: 'center', width: 495 });

    // Encadré stats
    const statsY = contentStartY + 200;
    doc.rect(100, statsY, 395, 180).fillAndStroke('#fff', colors.primary);

    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary)
       .text('Synthese', 120, statsY + 15, { width: 355, align: 'center' });

    const statsItems = [
      { label: 'Equipements ATEX', value: totalEquipments, color: colors.primary },
      { label: 'Conformes', value: conformeCount, color: colors.success },
      { label: 'Non conformes', value: nonConformeCount, color: colors.danger },
      { label: 'A verifier', value: naCount, color: colors.warning },
      { label: 'En retard', value: retardCount, color: colors.danger },
    ];

    let statY = statsY + 45;
    statsItems.forEach(item => {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(item.label, 130, statY);
      doc.font('Helvetica-Bold').fillColor(item.color).text(String(item.value), 400, statY, { width: 70, align: 'right' });
      statY += 25;
    });

    // Footer page de garde
    doc.fontSize(9).fillColor(colors.muted)
       .text(`${plans.length} plan(s) | ${subareas.length} zone(s) classee(s)`, 0, 780, { align: 'center', width: 595 });

    // ========== SOMMAIRE ==========
    doc.addPage();

    doc.fontSize(24).font('Helvetica-Bold').fillColor(colors.primary).text('Sommaire', 50, 50);
    doc.moveTo(50, 85).lineTo(545, 85).strokeColor(colors.primary).lineWidth(2).stroke();

    const sommaire = [
      { num: '1', title: 'Cadre reglementaire (Suisse)' },
      { num: '2', title: 'Presentation de l\'etablissement' },
      { num: '3', title: 'Plans ATEX' },
      { num: '4', title: 'Inventaire des equipements' },
      { num: '5', title: 'Etat de conformite' },
      { num: '6', title: 'Planification des verifications' },
      { num: '7', title: 'Mesures de prevention et protection' },
      { num: '8', title: 'Fiches equipements' },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.text).text(item.num, 50, somY);
      doc.font('Helvetica').text(item.title, 80, somY);
      const titleWidth = doc.widthOfString(item.title);
      doc.moveTo(85 + titleWidth, somY + 8).lineTo(500, somY + 8).dash(2, { space: 3 }).strokeColor(colors.muted).stroke();
      doc.undash();
      somY += 30;
    });

    // ========== 1. CADRE RÉGLEMENTAIRE SUISSE ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('1. Cadre reglementaire (Suisse)', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    doc.fontSize(11).font('Helvetica').fillColor(colors.text);
    let regY = 100;

    doc.font('Helvetica-Bold').text('Ordonnance sur la prevention des accidents (OPA)', 50, regY);
    regY += 20;
    doc.font('Helvetica').text(
      'L\'OPA (RS 832.30) fixe les exigences en matiere de securite au travail en Suisse. Elle impose aux employeurs de prendre toutes les mesures necessaires pour prevenir les accidents et maladies professionnels, y compris les risques d\'explosion.',
      50, regY, { width: 495, align: 'justify' }
    );
    regY += 60;

    doc.font('Helvetica-Bold').text('Directive CFST 6512 - Equipements de travail', 50, regY);
    regY += 20;
    doc.font('Helvetica').text(
      'Cette directive de la Commission federale de coordination pour la securite au travail (CFST) definit les exigences relatives aux equipements de travail, incluant les equipements utilises en zones ATEX.',
      50, regY, { width: 495, align: 'justify' }
    );
    regY += 55;

    doc.font('Helvetica-Bold').text('Ordonnance sur les appareils et systemes de protection ATEX (OSPA)', 50, regY);
    regY += 20;
    doc.font('Helvetica').text(
      'L\'OSPA (RS 734.6) transpose la directive europeenne 2014/34/UE en droit suisse. Elle definit les exigences essentielles de sante et securite pour les appareils destines a etre utilises en atmospheres explosibles.',
      50, regY, { width: 495, align: 'justify' }
    );
    regY += 60;

    // Encadré important
    doc.rect(50, regY, 495, 80).fillAndStroke('#fef3c7', colors.warning);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.warning).text('/!\\ IMPORTANT', 70, regY + 15);
    doc.font('Helvetica').fillColor(colors.text).text(
      'L\'employeur doit evaluer les risques d\'explosion, delimiter les zones dangereuses et s\'assurer que les equipements utilises sont conformes au zonage. Un document sur la protection contre les explosions doit etre etabli et maintenu a jour.',
      70, regY + 35, { width: 455 }
    );
    regY += 100;

    // Tableau zones
    doc.font('Helvetica-Bold').fillColor(colors.text).text('Classification des zones', 50, regY);
    regY += 25;

    const zoneData = [
      ['Zone', 'GAZ (G)', 'POUSSIERES (D)', 'Presence ATEX'],
      ['0 / 20', 'Zone 0', 'Zone 20', 'Permanente ou frequente'],
      ['1 / 21', 'Zone 1', 'Zone 21', 'Occasionnelle (fonct. normal)'],
      ['2 / 22', 'Zone 2', 'Zone 22', 'Rare et de courte duree'],
    ];

    const colW = [60, 120, 120, 195];
    zoneData.forEach((row, idx) => {
      let x = 50;
      const bgColor = idx === 0 ? colors.primary : (idx % 2 === 0 ? colors.light : '#fff');
      const txtColor = idx === 0 ? '#fff' : colors.text;
      doc.rect(x, regY, 495, 22).fillAndStroke(bgColor, '#d1d5db');
      row.forEach((cell, ci) => {
        doc.fontSize(9).font(idx === 0 ? 'Helvetica-Bold' : 'Helvetica').fillColor(txtColor)
           .text(cell, x + 5, regY + 6, { width: colW[ci] - 10 });
        x += colW[ci];
      });
      regY += 22;
    });

    // ========== 2. PRÉSENTATION ÉTABLISSEMENT ==========
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
    if (siteInfo.company_phone) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Telephone: ${siteInfo.company_phone}`, 50, presY);
      presY += 18;
    }
    if (siteInfo.company_email) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Email: ${siteInfo.company_email}`, 50, presY);
      presY += 18;
    }

    doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Site: ${siteInfo.site_name || siteName || 'Non renseigne'}`, 50, presY);
    presY += 40;

    // Stats globales
    doc.fontSize(12).font('Helvetica-Bold').text('Synthese de l\'installation', 50, presY);
    presY += 25;

    const statsData = [
      ['Equipements ATEX', totalEquipments],
      ['Plans', plans.length],
      ['Zones classees', subareas.length],
      ['Batiments', Object.keys(byBuilding).length],
    ];

    statsData.forEach(([label, value]) => {
      doc.rect(50, presY, 240, 35).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(10).font('Helvetica').fillColor(colors.muted).text(label, 60, presY + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(colors.primary).text(String(value), 220, presY + 8, { align: 'right', width: 50 });
      presY += 40;
    });

    // ========== 3. PLANS ATEX ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('3. Plans ATEX', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let planListY = 100;

    doc.fontSize(11).font('Helvetica').fillColor(colors.text)
       .text(`${plans.length} plan(s) disponible(s) pour cette installation.`, 50, planListY);
    planListY += 20;

    doc.fontSize(9).font('Helvetica').fillColor(colors.muted)
       .text(`Les vignettes des plans avec localisation des equipements sont affichees dans les fiches equipements (section 8).`, 50, planListY);
    planListY += 25;

    // Liste des plans
    plans.forEach((p, idx) => {
      if (planListY > 750) { doc.addPage(); planListY = 50; }

      doc.rect(50, planListY, 495, 25).fillAndStroke(idx % 2 === 0 ? colors.light : '#fff', '#e5e7eb');
      doc.fontSize(9).font('Helvetica').fillColor(colors.text)
         .text(`${idx + 1}. ${p.display_name || p.logical_name}`, 60, planListY + 7);
      if (p.building || p.zone) {
        doc.fillColor(colors.muted).text(`${p.building || ''} ${p.zone ? '- ' + p.zone : ''}`, 350, planListY + 7, { width: 180, align: 'right' });
      }
      planListY += 25;
    });

    // ========== 4. INVENTAIRE DES ÉQUIPEMENTS ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('4. Inventaire des equipements', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    doc.fontSize(11).font('Helvetica').fillColor(colors.text)
       .text(`${totalEquipments} equipement(s) ATEX inventorie(s).`, 50, invY);
    invY += 35;

    // Tableau par bâtiment
    const batHeaders = ['Batiment', 'Zone', 'Equip.', 'Conformes', 'Non conf.'];
    const batColW = [140, 140, 70, 75, 70];
    let x = 50;
    batHeaders.forEach((h, i) => {
      doc.rect(x, invY, batColW[i], 22).fillAndStroke(colors.primary, colors.primary);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff').text(h, x + 5, invY + 6, { width: batColW[i] - 10 });
      x += batColW[i];
    });
    invY += 22;

    Object.entries(byBuilding).forEach(([bat, zones]) => {
      Object.entries(zones).forEach(([zone, eqs]) => {
        if (invY > 750) {
          doc.addPage();
          invY = 50;
          x = 50;
          batHeaders.forEach((h, i) => {
            doc.rect(x, invY, batColW[i], 22).fillAndStroke(colors.primary, colors.primary);
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff').text(h, x + 5, invY + 6, { width: batColW[i] - 10 });
            x += batColW[i];
          });
          invY += 22;
        }
        const conf = eqs.filter(e => e.last_result === 'conforme').length;
        const nonConf = eqs.filter(e => e.last_result === 'non_conforme').length;
        const row = [bat.substring(0, 28), zone.substring(0, 28), eqs.length, conf, nonConf];
        x = 50;
        row.forEach((cell, i) => {
          doc.rect(x, invY, batColW[i], 20).fillAndStroke('#fff', '#e5e7eb');
          let txtCol = colors.text;
          if (i === 4 && cell > 0) txtCol = colors.danger;
          if (i === 3 && cell > 0) txtCol = colors.success;
          doc.fontSize(8).font('Helvetica').fillColor(txtCol).text(String(cell), x + 5, invY + 5, { width: batColW[i] - 10 });
          x += batColW[i];
        });
        invY += 20;
      });
    });

    // ========== 5. ÉTAT DE CONFORMITÉ ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('5. Etat de conformite', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let confY = 100;

    // Stats visuelles
    const confStats = [
      { label: 'Conformes', count: conformeCount, color: colors.success, pct: totalEquipments ? Math.round(conformeCount / totalEquipments * 100) : 0 },
      { label: 'Non conformes', count: nonConformeCount, color: colors.danger, pct: totalEquipments ? Math.round(nonConformeCount / totalEquipments * 100) : 0 },
      { label: 'Non verifies', count: naCount, color: colors.muted, pct: totalEquipments ? Math.round(naCount / totalEquipments * 100) : 0 },
      { label: 'Verification en retard', count: retardCount, color: colors.warning, pct: totalEquipments ? Math.round(retardCount / totalEquipments * 100) : 0 },
    ];

    confStats.forEach(stat => {
      doc.rect(50, confY, 495, 40).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).font('Helvetica-Bold').fillColor(stat.color).text(stat.label, 60, confY + 8);
      doc.fontSize(9).font('Helvetica').fillColor(colors.muted).text(`${stat.count} equipement(s)`, 60, confY + 23);
      doc.rect(300, confY + 15, 180, 12).fillAndStroke(colors.light, '#d1d5db');
      if (stat.pct > 0) {
        doc.rect(300, confY + 15, Math.max(5, 180 * stat.pct / 100), 12).fill(stat.color);
      }
      doc.fontSize(10).font('Helvetica-Bold').fillColor(stat.color).text(`${stat.pct}%`, 490, confY + 13, { align: 'right', width: 40 });
      confY += 45;
    });

    confY += 20;

    // TOUS les non conformes (sans limite)
    const nonConformes = equipments.filter(e => e.last_result === 'non_conforme');
    if (nonConformes.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.danger).text('/!\\ Equipements non conformes', 50, confY);
      confY += 25;

      nonConformes.forEach(eq => {
        if (confY > 750) { doc.addPage(); confY = 50; }
        doc.rect(50, confY, 495, 30).fillAndStroke('#fef2f2', '#fca5a5');
        doc.fontSize(9).font('Helvetica-Bold').fillColor(colors.danger).text(eq.name || 'Equipement sans nom', 60, confY + 6);
        doc.fontSize(8).font('Helvetica').fillColor(colors.muted)
           .text(`${eq.building || '-'} | ${eq.zone || '-'} | ${eq.type || '-'}`, 60, confY + 17);
        confY += 35;
      });
    }

    // ========== 6. PLANIFICATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('6. Planification des verifications', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let planY = 100;
    doc.fontSize(11).font('Helvetica').fillColor(colors.text)
       .text('Les equipements ATEX font l\'objet de verifications periodiques conformement a la reglementation suisse (OPA/CFST).', 50, planY, { width: 495 });
    planY += 40;

    // TOUS les équipements à vérifier (sans limite)
    const upcoming = equipments
      .filter(e => e.next_check_date)
      .sort((a, b) => new Date(a.next_check_date) - new Date(b.next_check_date));

    if (upcoming.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').text('Prochaines verifications', 50, planY);
      planY += 25;

      const planHeaders = ['Equipement', 'Batiment', 'Zone', 'Date verif.', 'Statut'];
      const planColW = [180, 100, 80, 85, 50];
      x = 50;
      planHeaders.forEach((h, i) => {
        doc.rect(x, planY, planColW[i], 20).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff').text(h, x + 4, planY + 5, { width: planColW[i] - 8 });
        x += planColW[i];
      });
      planY += 20;

      upcoming.forEach(eq => {
        if (planY > 750) {
          doc.addPage();
          planY = 50;
          x = 50;
          planHeaders.forEach((h, i) => {
            doc.rect(x, planY, planColW[i], 20).fillAndStroke(colors.primary, colors.primary);
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff').text(h, x + 4, planY + 5, { width: planColW[i] - 8 });
            x += planColW[i];
          });
          planY += 20;
        }
        const nextDate = new Date(eq.next_check_date);
        const now = new Date();
        const isLate = nextDate < now;
        const isClose = !isLate && (nextDate - now) / (1000 * 60 * 60 * 24) < 90;
        const statusColor = isLate ? colors.danger : (isClose ? colors.warning : colors.success);
        const statusText = isLate ? 'RETARD' : (isClose ? 'PROCHE' : 'OK');

        const row = [
          (eq.name || '-').substring(0, 35),
          (eq.building || '-').substring(0, 18),
          (eq.zone || '-').substring(0, 14),
          nextDate.toLocaleDateString('fr-FR'),
          statusText
        ];
        x = 50;
        row.forEach((cell, i) => {
          doc.rect(x, planY, planColW[i], 18).fillAndStroke('#fff', '#e5e7eb');
          const col = i === 4 ? statusColor : colors.text;
          doc.fontSize(7).font('Helvetica').fillColor(col).text(String(cell), x + 4, planY + 5, { width: planColW[i] - 8 });
          x += planColW[i];
        });
        planY += 18;
      });
    }

    // ========== 7. MESURES DE PRÉVENTION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('7. Mesures de prevention et protection', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let mesY = 100;
    const mesures = [
      { title: 'Mesures techniques', items: [
        'Utilisation d\'equipements ATEX conformes (directive 2014/34/UE / OSPA)',
        'Ventilation et extraction des atmospheres explosives',
        'Mise a la terre et equipotentialite des equipements',
        'Controle des sources d\'inflammation',
      ]},
      { title: 'Mesures organisationnelles', items: [
        'Formation du personnel aux risques ATEX',
        'Procedures de travail et permis de feu',
        'Signalisation des zones a risque d\'explosion',
        'Maintenance preventive des equipements',
      ]},
      { title: 'Mesures de protection', items: [
        'Detection de gaz/poussieres avec alarme',
        'Dispositifs d\'arret d\'urgence',
        'Equipements de protection individuelle adaptes',
        'Plan d\'intervention en cas d\'incident',
      ]},
    ];

    mesures.forEach(section => {
      if (mesY > 650) { doc.addPage(); mesY = 50; }
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.primary).text(section.title, 50, mesY);
      mesY += 22;
      section.items.forEach(item => {
        doc.fontSize(10).font('Helvetica').fillColor(colors.text).text(`- ${item}`, 70, mesY, { width: 475 });
        mesY += 20;
      });
      mesY += 15;
    });

    // Note finale
    mesY += 20;
    doc.rect(50, mesY, 495, 60).fillAndStroke('#f0fdfa', colors.success);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.success).text('[OK] Document conforme', 70, mesY + 15);
    doc.font('Helvetica').fillColor(colors.text).text(
      'Ce document doit etre mis a jour lors de toute modification des installations ou des conditions d\'exploitation.',
      70, mesY + 32, { width: 455 }
    );

    // ========== 8. FICHES EQUIPEMENTS ==========
    // Afficher tous les équipements avec vignette du plan si disponible
    if (equipments.length > 0) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('8. Fiches equipements', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted)
         .text(`${equipments.length} equipement(s) ATEX`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < equipments.length; i++) {
        const eq = equipments[i];
        const position = positionsMap.get(eq.id); // Position sur le plan si disponible

        if (ficheY > 450) {
          doc.addPage();
          ficheY = 50;
        }

        // Cadre de la fiche
        doc.rect(50, ficheY, 495, 320).stroke(colors.light);

        // En-tête avec le nom - couleur Haleon
        doc.rect(50, ficheY, 495, 35).fill(colors.primary);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#fff')
           .text(eq.name || 'Equipement sans nom', 60, ficheY + 10, { width: 380, lineBreak: false });

        // Statut
        const statusLabel = eq.last_result === 'conforme' ? 'CONFORME' : (eq.last_result === 'non_conforme' ? 'NON CONFORME' : 'A VERIFIER');
        const statusBg = eq.last_result === 'conforme' ? '#fff' : (eq.last_result === 'non_conforme' ? colors.danger : colors.warning);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(statusBg)
           .text(statusLabel, 450, ficheY + 13, { width: 80, align: 'right' });

        let infoY = ficheY + 45;
        const infoX = 60;
        const infoWidth = 240;
        const rightColX = 310;
        const imgWidth = 115;
        const imgHeight = 115;

        // === COLONNE DROITE: Photo équipement + Vignette plan ===
        let rightY = infoY;

        // Photo de l'équipement (en haut à droite)
        if (eq.photo_content && eq.photo_content.length > 0) {
          try {
            doc.image(eq.photo_content, rightColX, rightY, { fit: [imgWidth, imgHeight], align: 'center' });
            doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke('#e5e7eb');
          } catch (photoErr) {
            doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', rightColX + 35, rightY + 50);
          }
        } else {
          doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', rightColX + 30, rightY + 50);
        }

        // Vignette du plan avec localisation (à côté de la photo)
        const planX = rightColX + imgWidth + 10;
        if (position && (position.plan_thumbnail || position.plan_content)) {
          try {
            const planDisplayName = position.plan_display_name || 'Plan';
            let planThumbnail = null;

            // Priorité 1: Utiliser le thumbnail pré-généré (PNG)
            if (position.plan_thumbnail && position.plan_thumbnail.length > 0) {
              // Ajouter le marqueur de position sur le thumbnail
              const { loadImage } = await import('canvas');
              const thumbnailBuffer = Buffer.isBuffer(position.plan_thumbnail)
                ? position.plan_thumbnail
                : Buffer.from(position.plan_thumbnail);

              const img = await loadImage(thumbnailBuffer);
              const canvas = createCanvas(img.width, img.height);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);

              // Dessiner le marqueur de position si fourni
              if (position.x_frac !== null && position.y_frac !== null &&
                  !isNaN(position.x_frac) && !isNaN(position.y_frac)) {
                const markerX = position.x_frac * img.width;
                const markerY = position.y_frac * img.height;
                const markerRadius = Math.max(12, img.width / 25);

                // Cercle extérieur rouge
                ctx.beginPath();
                ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
                ctx.fillStyle = '#dc2626';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.stroke();

                // Point central blanc
                ctx.beginPath();
                ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
              }

              planThumbnail = canvas.toBuffer('image/png');
            } else {
              // Priorité 2: Essayer de convertir le PDF (fallback vers placeholder)
              planThumbnail = await pdfToImageWithMarker(
                position.plan_content,
                position.x_frac,
                position.y_frac,
                imgWidth * 2,
                planDisplayName
              );
            }

            if (planThumbnail) {
              doc.image(planThumbnail, planX, rightY, { fit: [imgWidth, imgHeight], align: 'center' });
              doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.primary);
              // Nom du plan en dessous
              doc.fontSize(6).fillColor(colors.muted)
                 .text(planDisplayName, planX, rightY + imgHeight + 2, { width: imgWidth, align: 'center', lineBreak: false });
            } else {
              doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
              doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', planX + 35, rightY + 50);
            }
          } catch (planErr) {
            console.warn(`[DRPCE] Plan thumbnail error for ${eq.name}:`, planErr.message);
            doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', planX + 35, rightY + 50);
          }
        } else {
          doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Non positionne', planX + 25, rightY + 50);
        }

        // === COLONNE GAUCHE: Informations ===
        const atexMarking = [eq.atex_mark_gas, eq.atex_mark_dust].filter(Boolean).join(' / ') || '-';
        const zoning = [eq.zoning_gas != null ? `Gaz: ${eq.zoning_gas}` : null, eq.zoning_dust != null ? `Pous.: ${eq.zoning_dust}` : null].filter(Boolean).join(' / ') || '-';
        const infoItems = [
          ['Type', eq.type || '-'],
          ['Batiment', eq.building || '-'],
          ['Zone', eq.zone || '-'],
          ['Fabricant', eq.manufacturer || '-'],
          ['Reference', eq.manufacturer_ref || '-'],
          ['Equipement', eq.equipment || '-'],
          ['Sous-equip.', eq.sub_equipment || '-'],
          ['Marquage ATEX', atexMarking],
          ['Zonage', zoning],
          ['Derniere verif.', eq.last_check_date ? new Date(eq.last_check_date).toLocaleDateString('fr-FR') : '-'],
          ['Prochaine verif.', eq.next_check_date ? new Date(eq.next_check_date).toLocaleDateString('fr-FR') : '-'],
        ];

        infoItems.forEach(([label, value]) => {
          doc.fontSize(9).font('Helvetica-Bold').fillColor(colors.text).text(label + ':', infoX, infoY, { width: 85 });
          doc.font('Helvetica').fillColor(colors.muted).text(value, infoX + 88, infoY, { width: infoWidth - 88, lineBreak: false });
          infoY += 16;
        });

        // Légende en bas de la fiche
        doc.fontSize(7).fillColor(colors.muted)
           .text('Photo equipement', rightColX, rightY + imgHeight + 2, { width: imgWidth, align: 'center' });

        ficheY += 330;
      }
    }

    // ========== NUMÉROTATION DES PAGES ==========
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = range.start; i < range.start + totalPages; i++) {
      doc.switchToPage(i);
      // Utiliser lineBreak: false pour éviter la création de pages supplémentaires
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Management Monitoring - ${siteInfo.company_name || 'Document'} - Page ${i + 1}/${totalPages}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[DRPCE] Generated PDF with ${totalEquipments} equipments, ${plans.length} plans`);

  } catch (e) {
    console.error('[DRPCE] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// FIN DU DRPCE
// -------------------------------------------------

await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[atex] listening on ${HOST}:${PORT}`);
  console.log(`[atex] ✅ VERSION OPTIMISÉE (90% plus rapide)`);
});
