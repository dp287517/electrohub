// scripts/db-migrate-admin.js
// Migration pour ajouter la gestion des entreprises et permissions
// Usage: DATABASE_URL="..." node scripts/db-migrate-admin.js

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
  console.log('🚀 Démarrage de la migration...\n');

  try {
    // 1. Créer la table companies
    console.log('1️⃣ Création de la table companies...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL DEFAULT 'Switzerland',
        city TEXT,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   ✅ Table companies créée\n');

    // 2. Insérer Haleon comme entreprise interne
    console.log('2️⃣ Création de l\'entreprise Haleon...');
    await pool.query(`
      INSERT INTO companies (name, country, city, is_internal)
      VALUES ('Haleon', 'Switzerland', 'Nyon', TRUE)
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('   ✅ Haleon ajoutée\n');

    // 3. Ajouter les colonnes à la table users si elles n'existent pas
    console.log('3️⃣ Mise à jour de la table users...');

    // Vérifier si la colonne company_id existe
    const checkCompanyId = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'company_id'
    `);

    if (checkCompanyId.rows.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES companies(id)`);
      console.log('   ✅ Colonne company_id ajoutée');
    } else {
      console.log('   ⏭️ Colonne company_id existe déjà');
    }

    // Vérifier si la colonne allowed_apps existe
    const checkAllowedApps = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'allowed_apps'
    `);

    if (checkAllowedApps.rows.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN allowed_apps TEXT[] DEFAULT NULL`);
      console.log('   ✅ Colonne allowed_apps ajoutée');
    } else {
      console.log('   ⏭️ Colonne allowed_apps existe déjà');
    }

    // Vérifier si la colonne is_admin existe
    const checkIsAdmin = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'is_admin'
    `);

    if (checkIsAdmin.rows.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE`);
      console.log('   ✅ Colonne is_admin ajoutée');
    } else {
      console.log('   ⏭️ Colonne is_admin existe déjà');
    }

    // Vérifier si la colonne origin existe (bubble, external, manual)
    const checkOrigin = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'origin'
    `);

    if (checkOrigin.rows.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN origin TEXT DEFAULT 'manual'`);
      console.log('   ✅ Colonne origin ajoutée');
    } else {
      console.log('   ⏭️ Colonne origin existe déjà');
    }
    console.log('');

    // 4. Récupérer l'ID de Haleon
    const haleonResult = await pool.query(`SELECT id FROM companies WHERE name = 'Haleon'`);
    const haleonId = haleonResult.rows[0]?.id;

    // 5. Mettre à jour les utilisateurs existants
    console.log('4️⃣ Mise à jour des utilisateurs existants...');

    // Associer tous les utilisateurs @haleon.com à Haleon
    const updateHaleon = await pool.query(`
      UPDATE users
      SET company_id = $1, origin = 'bubble'
      WHERE email LIKE '%@haleon.com' AND company_id IS NULL
    `, [haleonId]);
    console.log(`   ✅ ${updateHaleon.rowCount} utilisateurs Haleon mis à jour`);

    // Marquer les admins
    await pool.query(`
      UPDATE users
      SET is_admin = TRUE
      WHERE email IN ('daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com')
    `);
    console.log('   ✅ Admins marqués\n');

    // 6. Créer la table haleon_users pour les utilisateurs Bubble (optionnel)
    console.log('5️⃣ Création de la table haleon_users (utilisateurs Bubble)...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        site_id INTEGER REFERENCES sites(id),
        department_id INTEGER REFERENCES departments(id),
        allowed_apps TEXT[] DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   ✅ Table haleon_users créée\n');

    // 7. Migrer les utilisateurs de askv_users vers haleon_users
    console.log('6️⃣ Migration des utilisateurs Bubble existants...');

    // Récupérer les utilisateurs de askv_users qui sont @haleon.com
    const askvUsers = await pool.query(`
      SELECT DISTINCT email FROM askv_users
      WHERE email LIKE '%@haleon.com'
    `);

    // Récupérer le site Nyon
    const nyonSite = await pool.query(`SELECT id FROM sites WHERE code = 'Nyon' OR name = 'Nyon'`);
    const nyonId = nyonSite.rows[0]?.id || 1;

    for (const user of askvUsers.rows) {
      await pool.query(`
        INSERT INTO haleon_users (email, site_id)
        VALUES ($1, $2)
        ON CONFLICT (email) DO NOTHING
      `, [user.email, nyonId]);
    }
    console.log(`   ✅ ${askvUsers.rows.length} utilisateurs Haleon migrés\n`);

    // 8. Afficher le résumé
    console.log('═'.repeat(50));
    console.log('📊 RÉSUMÉ DE LA MIGRATION');
    console.log('═'.repeat(50));

    const companiesCount = await pool.query(`SELECT COUNT(*) FROM companies`);
    console.log(`\n🏢 Entreprises: ${companiesCount.rows[0].count}`);

    const usersCount = await pool.query(`SELECT COUNT(*) FROM users`);
    console.log(`👤 Utilisateurs (externe): ${usersCount.rows[0].count}`);

    const haleonUsersCount = await pool.query(`SELECT COUNT(*) FROM haleon_users`);
    console.log(`🔵 Utilisateurs Haleon: ${haleonUsersCount.rows[0].count}`);

    const sitesCount = await pool.query(`SELECT COUNT(*) FROM sites`);
    console.log(`📍 Sites: ${sitesCount.rows[0].count}`);

    const deptCount = await pool.query(`SELECT COUNT(*) FROM departments`);
    console.log(`🏷️ Départements: ${deptCount.rows[0].count}`);

    console.log('\n✅ Migration terminée avec succès!');

  } catch (err) {
    console.error('❌ Erreur de migration:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

migrate();
