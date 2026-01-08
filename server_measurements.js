// server_measurements.js — API pour les mesures sur plans et configuration d'échelle
// VERSION 1.0 - MULTI-TENANT (Company + Site)

import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import PDFDocument from "pdfkit";
import { extractTenantFromRequest, getTenantFilter, requireTenant } from "./lib/tenant-filter.js";

dotenv.config();

const router = express.Router();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// Middleware pour extraire l'utilisateur du JWT
function extractUser(req, _res, next) {
  if (req.user) return next();

  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (token) {
    try {
      const secret = process.env.JWT_SECRET || "devsecret";
      req.user = jwt.verify(token, secret);
    } catch (e) {
      // Token invalide, continuer sans user
    }
  }
  next();
}

router.use(extractUser);

// ============================================================
// SCALE CONFIGURATION - Configuration de l'échelle des plans
// ============================================================

/**
 * GET /api/measurements/scale/:planId
 * Récupère la configuration d'échelle d'un plan
 */
router.get("/scale/:planId", async (req, res) => {
  try {
    const { planId } = req.params;
    const pageIndex = parseInt(req.query.page) || 0;
    console.log("[measurements] GET /scale - planId:", planId, "pageIndex:", pageIndex);

    // Chercher dans plan_scale_config
    const { rows } = await pool.query(
      `SELECT * FROM plan_scale_config
       WHERE plan_id = $1 AND page_index = $2`,
      [planId, pageIndex]
    );
    console.log("[measurements] GET /scale - plan_scale_config rows:", rows.length);

    if (rows.length === 0) {
      // Fallback: chercher dans vsd_plans
      const planRes = await pool.query(
        `SELECT scale_meters_per_pixel, scale_reference, scale_validated_at
         FROM vsd_plans WHERE id = $1`,
        [planId]
      );
      console.log("[measurements] GET /scale - vsd_plans fallback rows:", planRes.rows.length,
        planRes.rows[0]?.scale_meters_per_pixel ? "has scale" : "no scale");

      if (planRes.rows.length > 0 && planRes.rows[0].scale_meters_per_pixel) {
        return res.json({
          ok: true,
          scale: {
            plan_id: planId,
            page_index: pageIndex,
            scale_meters_per_pixel: parseFloat(planRes.rows[0].scale_meters_per_pixel),
            reference: planRes.rows[0].scale_reference,
            validated_at: planRes.rows[0].scale_validated_at,
            source: 'plan'
          }
        });
      }

      console.log("[measurements] GET /scale - no scale found, returning null");
      return res.json({ ok: true, scale: null });
    }

    console.log("[measurements] GET /scale - returning scale from config:", rows[0].scale_meters_per_pixel);
    res.json({
      ok: true,
      scale: {
        ...rows[0],
        scale_meters_per_pixel: parseFloat(rows[0].scale_meters_per_pixel),
        source: 'config'
      }
    });
  } catch (err) {
    console.error("[measurements] Error getting scale:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/measurements/scale
 * Sauvegarde la configuration d'échelle d'un plan
 * Body: { planId, pageIndex, point1, point2, realDistanceMeters, imageWidth, imageHeight, scaleRatio }
 */
router.post("/scale", requireTenant(), async (req, res) => {
  console.log("[measurements] POST /scale called");
  console.log("[measurements] req.body:", JSON.stringify(req.body));
  console.log("[measurements] req.tenant:", req.tenant);

  try {
    const { planId, pageIndex = 0, point1, point2, realDistanceMeters, imageWidth, imageHeight, scaleRatio } = req.body;
    // Tenant uses camelCase (companyId, siteId), but DB uses snake_case
    let { companyId: company_id, siteId: site_id } = req.tenant || {};

    if (!planId || !point1 || !point2 || !realDistanceMeters) {
      console.log("[measurements] Missing required fields");
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    console.log("[measurements] Tenant values:", { company_id, site_id });

    // Calculer la distance en pixels entre les deux points
    const dx = (point2.x - point1.x) * (imageWidth || 1);
    const dy = (point2.y - point1.y) * (imageHeight || 1);
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    console.log("[measurements] Calculated pixelDistance:", pixelDistance);

    if (pixelDistance === 0) {
      console.log("[measurements] Points are the same");
      return res.status(400).json({ ok: false, error: "Points must be different" });
    }

    // Calculer l'échelle: mètres par pixel
    const scaleMetersPerPixel = realDistanceMeters / pixelDistance;
    console.log("[measurements] Calculated scaleMetersPerPixel:", scaleMetersPerPixel);

    // Upsert dans plan_scale_config (avec scale_ratio si fourni)
    console.log("[measurements] Inserting into plan_scale_config...");
    const { rows } = await pool.query(
      `INSERT INTO plan_scale_config (
        plan_id, page_index, scale_meters_per_pixel,
        reference_point1, reference_point2, real_distance_meters,
        image_width, image_height, company_id, site_id, scale_ratio, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (plan_id, page_index) DO UPDATE SET
        scale_meters_per_pixel = EXCLUDED.scale_meters_per_pixel,
        reference_point1 = EXCLUDED.reference_point1,
        reference_point2 = EXCLUDED.reference_point2,
        real_distance_meters = EXCLUDED.real_distance_meters,
        image_width = EXCLUDED.image_width,
        image_height = EXCLUDED.image_height,
        scale_ratio = EXCLUDED.scale_ratio,
        updated_at = NOW()
      RETURNING *`,
      [planId, pageIndex, scaleMetersPerPixel,
       JSON.stringify(point1), JSON.stringify(point2), realDistanceMeters,
       imageWidth, imageHeight, company_id, site_id, scaleRatio || null]
    );
    console.log("[measurements] Insert result:", rows[0]);

    // Aussi mettre à jour vsd_plans pour compatibilité
    console.log("[measurements] Updating vsd_plans...");
    await pool.query(
      `UPDATE vsd_plans SET
        scale_meters_per_pixel = $1,
        scale_reference = $2,
        scale_validated_at = NOW()
       WHERE id = $3`,
      [scaleMetersPerPixel, JSON.stringify({ point1, point2, realDistanceMeters, scaleRatio }), planId]
    );
    console.log("[measurements] vsd_plans updated");

    const response = {
      ok: true,
      scale: {
        ...rows[0],
        scale_meters_per_pixel: parseFloat(rows[0].scale_meters_per_pixel),
        scale_ratio: rows[0].scale_ratio
      }
    };
    console.log("[measurements] Sending response:", response);
    res.json(response);
  } catch (err) {
    console.error("[measurements] Error saving scale:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/measurements/scale/:planId
 * Supprime la configuration d'échelle d'un plan
 */
router.delete("/scale/:planId", requireTenant(), async (req, res) => {
  try {
    const { planId } = req.params;
    const pageIndex = parseInt(req.query.page) || 0;

    await pool.query(
      `DELETE FROM plan_scale_config WHERE plan_id = $1 AND page_index = $2`,
      [planId, pageIndex]
    );

    // Aussi nettoyer vsd_plans
    await pool.query(
      `UPDATE vsd_plans SET
        scale_meters_per_pixel = NULL,
        scale_reference = NULL,
        scale_validated_at = NULL
       WHERE id = $1`,
      [planId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[measurements] Error deleting scale:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/measurements/plans-without-scale
 * Liste les plans qui n'ont pas d'échelle configurée
 */
router.get("/plans-without-scale", requireTenant(), async (req, res) => {
  try {
    // Tenant uses camelCase (companyId, siteId), convert to snake_case for DB
    const { companyId: company_id, siteId: site_id } = req.tenant || {};

    const { rows } = await pool.query(`
      SELECT p.id, p.logical_name, p.filename, p.page_count, p.version,
             n.display_name
      FROM vsd_plans p
      LEFT JOIN vsd_plan_names n ON n.logical_name = p.logical_name
      LEFT JOIN plan_scale_config sc ON sc.plan_id = p.id
      WHERE sc.id IS NULL
        AND p.scale_meters_per_pixel IS NULL
      ORDER BY p.logical_name
    `);

    res.json({ ok: true, plans: rows });
  } catch (err) {
    console.error("[measurements] Error getting plans without scale:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// MEASUREMENTS - CRUD pour les mesures utilisateur
// ============================================================

/**
 * GET /api/measurements/:planId
 * Récupère les mesures d'un utilisateur pour un plan donné
 */
router.get("/:planId", async (req, res) => {
  try {
    const { planId } = req.params;
    const pageIndex = parseInt(req.query.page) || 0;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const { rows } = await pool.query(
      `SELECT * FROM map_measurements
       WHERE plan_id = $1 AND page_index = $2 AND user_id = $3
       ORDER BY created_at DESC`,
      [planId, pageIndex, userId]
    );

    res.json({
      ok: true,
      measurements: rows.map(m => ({
        ...m,
        distance_meters: m.distance_meters ? parseFloat(m.distance_meters) : null,
        area_square_meters: m.area_square_meters ? parseFloat(m.area_square_meters) : null
      }))
    });
  } catch (err) {
    console.error("[measurements] Error getting measurements:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/measurements
 * Crée une nouvelle mesure
 * Body: { planId, pageIndex, type, points, label?, color? }
 */
router.post("/", requireTenant(), async (req, res) => {
  try {
    const { planId, pageIndex = 0, type, points, label, color } = req.body;
    // Tenant uses camelCase (companyId, siteId), convert to snake_case for DB
    const { companyId: company_id, siteId: site_id } = req.tenant || {};
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    if (!planId || !type || !points || !Array.isArray(points)) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    if (!['line', 'polygon'].includes(type)) {
      return res.status(400).json({ ok: false, error: "Type must be 'line' or 'polygon'" });
    }

    // Récupérer l'échelle pour calculer les distances/surfaces
    const scaleRes = await pool.query(
      `SELECT scale_meters_per_pixel, image_width, image_height
       FROM plan_scale_config WHERE plan_id = $1 AND page_index = $2`,
      [planId, pageIndex]
    );

    let distanceMeters = null;
    let areaSquareMeters = null;

    if (scaleRes.rows.length > 0) {
      const { scale_meters_per_pixel, image_width, image_height } = scaleRes.rows[0];
      const scale = parseFloat(scale_meters_per_pixel);
      const w = image_width || 1000;
      const h = image_height || 1000;

      if (type === 'line' && points.length >= 2) {
        // Calculer la distance totale de la ligne
        let totalDistance = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const dx = (points[i + 1].x - points[i].x) * w;
          const dy = (points[i + 1].y - points[i].y) * h;
          totalDistance += Math.sqrt(dx * dx + dy * dy);
        }
        distanceMeters = totalDistance * scale;
      } else if (type === 'polygon' && points.length >= 3) {
        // Calculer la surface avec la formule du lacet (Shoelace)
        let area = 0;
        for (let i = 0; i < points.length; i++) {
          const j = (i + 1) % points.length;
          const xi = points[i].x * w * scale;
          const yi = points[i].y * h * scale;
          const xj = points[j].x * w * scale;
          const yj = points[j].y * h * scale;
          area += xi * yj - xj * yi;
        }
        areaSquareMeters = Math.abs(area / 2);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO map_measurements (
        plan_id, page_index, type, points, label, color,
        distance_meters, area_square_meters,
        user_id, company_id, site_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [planId, pageIndex, type, JSON.stringify(points), label, color || '#ef4444',
       distanceMeters, areaSquareMeters, userId, company_id, site_id]
    );

    res.json({
      ok: true,
      measurement: {
        ...rows[0],
        distance_meters: rows[0].distance_meters ? parseFloat(rows[0].distance_meters) : null,
        area_square_meters: rows[0].area_square_meters ? parseFloat(rows[0].area_square_meters) : null
      }
    });
  } catch (err) {
    console.error("[measurements] Error creating measurement:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/measurements/:id
 * Met à jour une mesure existante
 */
router.put("/:id", requireTenant(), async (req, res) => {
  try {
    const { id } = req.params;
    const { points, label, color } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    // Vérifier que la mesure appartient à l'utilisateur
    const existing = await pool.query(
      `SELECT * FROM map_measurements WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Measurement not found" });
    }

    const measurement = existing.rows[0];
    const newPoints = points || measurement.points;

    // Recalculer les distances/surfaces si les points ont changé
    let distanceMeters = measurement.distance_meters;
    let areaSquareMeters = measurement.area_square_meters;

    if (points) {
      const scaleRes = await pool.query(
        `SELECT scale_meters_per_pixel, image_width, image_height
         FROM plan_scale_config WHERE plan_id = $1 AND page_index = $2`,
        [measurement.plan_id, measurement.page_index]
      );

      if (scaleRes.rows.length > 0) {
        const { scale_meters_per_pixel, image_width, image_height } = scaleRes.rows[0];
        const scale = parseFloat(scale_meters_per_pixel);
        const w = image_width || 1000;
        const h = image_height || 1000;

        if (measurement.type === 'line' && newPoints.length >= 2) {
          let totalDistance = 0;
          for (let i = 0; i < newPoints.length - 1; i++) {
            const dx = (newPoints[i + 1].x - newPoints[i].x) * w;
            const dy = (newPoints[i + 1].y - newPoints[i].y) * h;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
          }
          distanceMeters = totalDistance * scale;
        } else if (measurement.type === 'polygon' && newPoints.length >= 3) {
          let area = 0;
          for (let i = 0; i < newPoints.length; i++) {
            const j = (i + 1) % newPoints.length;
            const xi = newPoints[i].x * w * scale;
            const yi = newPoints[i].y * h * scale;
            const xj = newPoints[j].x * w * scale;
            const yj = newPoints[j].y * h * scale;
            area += xi * yj - xj * yi;
          }
          areaSquareMeters = Math.abs(area / 2);
        }
      }
    }

    const { rows } = await pool.query(
      `UPDATE map_measurements SET
        points = $1,
        label = $2,
        color = $3,
        distance_meters = $4,
        area_square_meters = $5,
        updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [JSON.stringify(newPoints), label ?? measurement.label, color ?? measurement.color,
       distanceMeters, areaSquareMeters, id, userId]
    );

    res.json({
      ok: true,
      measurement: {
        ...rows[0],
        distance_meters: rows[0].distance_meters ? parseFloat(rows[0].distance_meters) : null,
        area_square_meters: rows[0].area_square_meters ? parseFloat(rows[0].area_square_meters) : null
      }
    });
  } catch (err) {
    console.error("[measurements] Error updating measurement:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/measurements/:id
 * Supprime une mesure
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const result = await pool.query(
      `DELETE FROM map_measurements WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Measurement not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[measurements] Error deleting measurement:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/measurements/plan/:planId/all
 * Supprime toutes les mesures d'un utilisateur pour un plan
 */
router.delete("/plan/:planId/all", async (req, res) => {
  try {
    const { planId } = req.params;
    const pageIndex = parseInt(req.query.page);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    let query = `DELETE FROM map_measurements WHERE plan_id = $1 AND user_id = $2`;
    const params = [planId, userId];

    if (!isNaN(pageIndex)) {
      query += ` AND page_index = $3`;
      params.push(pageIndex);
    }

    const result = await pool.query(query + ' RETURNING id', params);

    res.json({ ok: true, deleted: result.rows.length });
  } catch (err) {
    console.error("[measurements] Error deleting all measurements:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// EXPORT PDF - Export du plan avec les mesures
// ============================================================

/**
 * GET /api/measurements/export/:planId
 * Génère un PDF du plan avec les mesures de l'utilisateur
 */
router.get("/export/:planId", async (req, res) => {
  try {
    const { planId } = req.params;
    const pageIndex = parseInt(req.query.page) || 0;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    // Récupérer le plan
    const planRes = await pool.query(
      `SELECT logical_name, filename, content FROM vsd_plans WHERE id = $1`,
      [planId]
    );

    if (planRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Plan not found" });
    }

    const plan = planRes.rows[0];

    // Récupérer les mesures
    const measurementsRes = await pool.query(
      `SELECT * FROM map_measurements
       WHERE plan_id = $1 AND page_index = $2 AND user_id = $3`,
      [planId, pageIndex, userId]
    );

    // Récupérer la config d'échelle
    const scaleRes = await pool.query(
      `SELECT * FROM plan_scale_config WHERE plan_id = $1 AND page_index = $2`,
      [planId, pageIndex]
    );

    const scale = scaleRes.rows[0];
    const measurements = measurementsRes.rows;

    // Créer le PDF
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="mesures_${plan.logical_name}_page${pageIndex + 1}.pdf"`);

    doc.pipe(res);

    // Titre
    doc.fontSize(16).text(`Plan: ${plan.logical_name}`, 50, 30);
    doc.fontSize(10).text(`Page ${pageIndex + 1} - Exporté le ${new Date().toLocaleDateString('fr-FR')}`, 50, 50);

    // Note sur l'échelle
    if (scale) {
      doc.fontSize(9).text(
        `Echelle: 1 pixel = ${(parseFloat(scale.scale_meters_per_pixel) * 100).toFixed(4)} cm`,
        50, 65
      );
    } else {
      doc.fontSize(9).fillColor('red').text('Attention: Echelle non configurée', 50, 65).fillColor('black');
    }

    // Liste des mesures
    doc.fontSize(12).text('Mesures:', 50, 90);

    let y = 110;
    measurements.forEach((m, i) => {
      const label = m.label || `Mesure ${i + 1}`;
      let value = '';

      if (m.type === 'line' && m.distance_meters) {
        const d = parseFloat(m.distance_meters);
        value = d >= 1 ? `${d.toFixed(2)} m` : `${(d * 100).toFixed(1)} cm`;
      } else if (m.type === 'polygon' && m.area_square_meters) {
        value = `${parseFloat(m.area_square_meters).toFixed(2)} m²`;
      }

      doc.fontSize(10)
        .fillColor(m.color || '#ef4444')
        .text(`${i + 1}. ${label}: ${value}`, 60, y)
        .fillColor('black');

      y += 20;
    });

    // Note de bas de page
    doc.fontSize(8)
      .fillColor('gray')
      .text('Note: Ce document contient les mesures personnelles de l\'utilisateur.', 50, 550)
      .fillColor('black');

    doc.end();

  } catch (err) {
    console.error("[measurements] Error exporting PDF:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// INIT TABLES - Création des tables si elles n'existent pas
// ============================================================

export async function initMeasurementsTables() {
  try {
    // Vérifier et créer la table plan_scale_config
    await pool.query(`
      CREATE TABLE IF NOT EXISTS plan_scale_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL,
        page_index INTEGER DEFAULT 0,
        scale_meters_per_pixel NUMERIC NOT NULL,
        reference_point1 JSONB NOT NULL,
        reference_point2 JSONB NOT NULL,
        real_distance_meters NUMERIC NOT NULL,
        image_width INTEGER,
        image_height INTEGER,
        company_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(plan_id, page_index)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_scale_config_plan
      ON plan_scale_config(plan_id, page_index)
    `);

    // Vérifier et créer la table map_measurements
    await pool.query(`
      CREATE TABLE IF NOT EXISTS map_measurements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL,
        page_index INTEGER DEFAULT 0,
        type TEXT NOT NULL CHECK (type IN ('line', 'polygon')),
        points JSONB NOT NULL,
        distance_meters NUMERIC,
        area_square_meters NUMERIC,
        label TEXT,
        color TEXT DEFAULT '#ef4444',
        user_id TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Fix: Alter user_id column from INTEGER to TEXT if needed (for UUID support)
    try {
      const checkUserIdType = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'map_measurements' AND column_name = 'user_id'
      `);
      if (checkUserIdType.rows.length > 0 && checkUserIdType.rows[0].data_type === 'integer') {
        console.log('[measurements] Altering user_id column from INTEGER to TEXT...');
        await pool.query(`ALTER TABLE map_measurements ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT`);
        console.log('[measurements] user_id column altered to TEXT');
      }
    } catch (alterErr) {
      console.error('[measurements] Error altering user_id column:', alterErr.message);
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_map_measurements_user_plan
      ON map_measurements(user_id, plan_id, page_index)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_map_measurements_tenant
      ON map_measurements(company_id, site_id)
    `);

    // Ajouter la colonne scale_ratio à plan_scale_config si elle n'existe pas
    const checkScaleRatio = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'plan_scale_config' AND column_name = 'scale_ratio'
    `);
    if (checkScaleRatio.rows.length === 0) {
      await pool.query(`ALTER TABLE plan_scale_config ADD COLUMN scale_ratio INTEGER`);
      console.log('[measurements] Added column scale_ratio to plan_scale_config');
    }

    // Ajouter les colonnes d'échelle à vsd_plans si elles n'existent pas
    const cols = ['scale_meters_per_pixel NUMERIC', 'scale_reference JSONB', 'scale_validated_at TIMESTAMPTZ', 'content_hash TEXT'];
    for (const col of cols) {
      const colName = col.split(' ')[0];
      const check = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'vsd_plans' AND column_name = $1
      `, [colName]);

      if (check.rows.length === 0) {
        await pool.query(`ALTER TABLE vsd_plans ADD COLUMN IF NOT EXISTS ${col}`);
        console.log(`[measurements] Added column ${colName} to vsd_plans`);
      }
    }

    console.log('[measurements] Tables initialized successfully');
  } catch (err) {
    console.error('[measurements] Error initializing tables:', err);
  }
}

export default router;
