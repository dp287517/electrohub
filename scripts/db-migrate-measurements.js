// scripts/db-migrate-measurements.js
// Migration pour ajouter le système de mesures sur les plans
// Usage: DATABASE_URL="..." node scripts/db-migrate-measurements.js

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL ou NEON_DATABASE_URL requis');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function migrate() {
  console.log('🚀 Démarrage de la migration pour les mesures...\n');

  try {
    // 1. Ajouter les colonnes d'échelle à vsd_plans
    console.log('1️⃣ Ajout des colonnes d\'échelle à vsd_plans...');

    // scale_meters_per_pixel: le facteur de conversion pixels -> mètres
    const checkScale = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vsd_plans' AND column_name = 'scale_meters_per_pixel'
    `);

    if (checkScale.rows.length === 0) {
      await pool.query(`ALTER TABLE vsd_plans ADD COLUMN scale_meters_per_pixel NUMERIC`);
      console.log('   ✅ Colonne scale_meters_per_pixel ajoutée');
    } else {
      console.log('   ⏭️ Colonne scale_meters_per_pixel existe déjà');
    }

    // scale_reference: stocke les 2 points de référence et la distance réelle
    const checkRef = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vsd_plans' AND column_name = 'scale_reference'
    `);

    if (checkRef.rows.length === 0) {
      await pool.query(`ALTER TABLE vsd_plans ADD COLUMN scale_reference JSONB`);
      console.log('   ✅ Colonne scale_reference ajoutée');
    } else {
      console.log('   ⏭️ Colonne scale_reference existe déjà');
    }

    // scale_validated_at: timestamp de dernière validation
    const checkValidated = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vsd_plans' AND column_name = 'scale_validated_at'
    `);

    if (checkValidated.rows.length === 0) {
      await pool.query(`ALTER TABLE vsd_plans ADD COLUMN scale_validated_at TIMESTAMPTZ`);
      console.log('   ✅ Colonne scale_validated_at ajoutée');
    } else {
      console.log('   ⏭️ Colonne scale_validated_at existe déjà');
    }

    // content_hash: pour détecter si le plan a été modifié
    const checkHash = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vsd_plans' AND column_name = 'content_hash'
    `);

    if (checkHash.rows.length === 0) {
      await pool.query(`ALTER TABLE vsd_plans ADD COLUMN content_hash TEXT`);
      console.log('   ✅ Colonne content_hash ajoutée');
    } else {
      console.log('   ⏭️ Colonne content_hash existe déjà');
    }

    console.log('');

    // 2. Créer la table map_measurements pour stocker les mesures utilisateur
    console.log('2️⃣ Création de la table map_measurements...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS map_measurements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Référence au plan
        plan_id UUID NOT NULL,
        page_index INTEGER DEFAULT 0,

        -- Type de mesure
        type TEXT NOT NULL CHECK (type IN ('line', 'polygon')),

        -- Géométrie (coordonnées fractionnaires 0-1)
        points JSONB NOT NULL,

        -- Valeurs calculées
        distance_meters NUMERIC,
        area_square_meters NUMERIC,

        -- Métadonnées
        label TEXT,
        color TEXT DEFAULT '#ef4444',

        -- Propriétaire (mesures privées par utilisateur) - TEXT pour UUID
        user_id TEXT NOT NULL,

        -- Multi-tenant
        company_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,

        -- Timestamps
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   ✅ Table map_measurements créée');

    // Index pour les requêtes fréquentes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_map_measurements_user_plan
      ON map_measurements(user_id, plan_id, page_index)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_map_measurements_tenant
      ON map_measurements(company_id, site_id)
    `);
    console.log('   ✅ Index créés');
    console.log('');

    // 3. Créer la table plan_scale_config pour une config par page si nécessaire
    console.log('3️⃣ Création de la table plan_scale_config (échelle par page)...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plan_scale_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        plan_id UUID NOT NULL,
        page_index INTEGER DEFAULT 0,

        -- Échelle pour cette page spécifique
        scale_meters_per_pixel NUMERIC NOT NULL,

        -- Ratio d'échelle (ex: 100 pour 1:100)
        scale_ratio INTEGER,

        -- Points de référence utilisés pour calibrer
        reference_point1 JSONB NOT NULL,
        reference_point2 JSONB NOT NULL,
        real_distance_meters NUMERIC NOT NULL,

        -- Dimensions de l'image au moment de la calibration
        image_width INTEGER,
        image_height INTEGER,

        -- Multi-tenant
        company_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,

        -- Timestamps
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),

        -- Une seule config par plan/page
        UNIQUE(plan_id, page_index)
      )
    `);
    console.log('   ✅ Table plan_scale_config créée');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_scale_config_plan
      ON plan_scale_config(plan_id, page_index)
    `);
    console.log('   ✅ Index créé');
    console.log('');

    // 4. Afficher le résumé
    console.log('═'.repeat(50));
    console.log('📊 RÉSUMÉ DE LA MIGRATION');
    console.log('═'.repeat(50));

    const measurementsCount = await pool.query(`SELECT COUNT(*) FROM map_measurements`);
    console.log(`\n📏 Mesures: ${measurementsCount.rows[0].count}`);

    const scaleConfigCount = await pool.query(`SELECT COUNT(*) FROM plan_scale_config`);
    console.log(`📐 Configs d'échelle: ${scaleConfigCount.rows[0].count}`);

    // Vérifier les colonnes ajoutées à vsd_plans
    const vsdCols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vsd_plans'
      AND column_name IN ('scale_meters_per_pixel', 'scale_reference', 'scale_validated_at', 'content_hash')
    `);
    console.log(`🗺️ Colonnes échelle dans vsd_plans: ${vsdCols.rows.map(r => r.column_name).join(', ')}`);

    console.log('\n✅ Migration terminée avec succès!');

  } catch (err) {
    console.error('❌ Erreur de migration:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    await pool.end();
  }
}

migrate();
