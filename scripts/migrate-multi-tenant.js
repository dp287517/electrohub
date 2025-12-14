// migrate-multi-tenant.js
// =============================================================================
// MIGRATION MULTI-TENANT COMPLÈTE
// Restructure toutes les données par Company (Entreprise) et Site
// =============================================================================
//
// ARCHITECTURE:
// - Company (Entreprise): Niveau le plus haut d'isolation
// - Site: Sous-division d'une entreprise (ex: Nyon, Prangins, etc.)
// - User Role:
//   - "site" = accès uniquement à son site
//   - "global" = accès à tous les sites de son entreprise (supervision)
//   - "admin" = accès complet + administration
//
// =============================================================================

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =============================================================================
// CONFIGURATION DES TABLES À MIGRER
// =============================================================================

// Tables qui ont DÉJÀ une colonne "site TEXT" - besoin d'ajouter company_id
const TABLES_WITH_SITE_TEXT = [
  // Switchboard module
  { table: 'switchboards', siteColumn: 'site' },
  { table: 'devices', siteColumn: 'site' },
  { table: 'site_settings', siteColumn: 'site' },
  { table: 'scanned_products', siteColumn: 'site' },
  { table: 'control_templates', siteColumn: 'site' },
  { table: 'control_schedules', siteColumn: 'site' },
  { table: 'control_records', siteColumn: 'site' },
  { table: 'control_attachments', siteColumn: 'site' },

  // HV module
  { table: 'hv_switchboards', siteColumn: 'site' },
  { table: 'hv_equipment', siteColumn: 'site' },
  { table: 'hv_cells', siteColumn: 'site' },
  { table: 'hv_tests', siteColumn: 'site' },
  { table: 'hv_maintenance', siteColumn: 'site' },

  // Arc Flash module
  { table: 'arcflash_studies', siteColumn: 'site' },
  { table: 'arcflash_switchboards', siteColumn: 'site' },
  { table: 'arcflash_equipment', siteColumn: 'site' },
  { table: 'arcflash_results', siteColumn: 'site' },
  { table: 'arcflash_labels', siteColumn: 'site' },

  // Projects module
  { table: 'projects', siteColumn: 'site' },
  { table: 'project_tasks', siteColumn: 'site' },
  { table: 'project_milestones', siteColumn: 'site' },

  // Selectivity module
  { table: 'selectivity_studies', siteColumn: 'site' },
  { table: 'selectivity_devices', siteColumn: 'site' },

  // FLA module
  { table: 'fla_studies', siteColumn: 'site' },
  { table: 'fla_calculations', siteColumn: 'site' },

  // Obsolescence module
  { table: 'obsolescence_items', siteColumn: 'site' },
];

// Tables qui N'ONT PAS de colonne site - besoin d'ajouter company_id ET site_id
const TABLES_WITHOUT_SITE = [
  // ATEX module
  'atex_equipments',
  'atex_checks',
  'atex_files',
  'atex_plans',
  'atex_plan_names',
  'atex_positions',
  'atex_subareas',
  'atex_settings',
  'atex_events',

  // MECA module (équipements électromécaniques)
  'meca_equipments',
  'meca_checks',
  'meca_files',
  'meca_plans',
  'meca_plan_names',
  'meca_positions',
  'meca_subareas',
  'meca_settings',
  'meca_events',

  // VSD module (variateurs)
  'vsd_units',
  'vsd_parameters',
  'vsd_maintenance',
  'vsd_alarms',
  'vsd_files',

  // Fire Doors module
  'fire_doors',
  'fire_door_checks',
  'fire_door_files',

  // Comp-Ext module (prestataires)
  'compext_contractors',
  'compext_interventions',
  'compext_evaluations',

  // Ask Veeva module
  'askv_documents',
  'askv_questions',
  'askv_answers',
  'askv_users',

  // DCF module
  'dcf_documents',
  'dcf_categories',

  // Learn-Ex module
  'learnex_incidents',
  'learnex_lessons',
  'learnex_actions',

  // Loop Calc module
  'loopcalc_studies',
  'loopcalc_results',

  // OIBT module
  'oibt_inspections',
  'oibt_findings',
  'oibt_reports',
];

// =============================================================================
// FONCTIONS DE MIGRATION
// =============================================================================

async function log(message, type = 'info') {
  const icons = {
    info: '📋',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    step: '🔄'
  };
  console.log(`${icons[type] || '•'} ${message}`);
}

async function tableExists(tableName) {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    );
  `, [tableName]);
  return result.rows[0].exists;
}

async function columnExists(tableName, columnName) {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    );
  `, [tableName, columnName]);
  return result.rows[0].exists;
}

async function addColumnIfNotExists(tableName, columnName, columnDef) {
  const exists = await columnExists(tableName, columnName);
  if (!exists) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
    log(`  Ajouté ${columnName} à ${tableName}`, 'success');
    return true;
  }
  return false;
}

// =============================================================================
// ÉTAPE 1: Créer/Mettre à jour les tables de base (companies, sites, users)
// =============================================================================

async function step1_CreateBaseTables() {
  log('ÉTAPE 1: Création des tables de base', 'step');

  // 1.1 Table companies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE, -- Code court (ex: HAL, NOV, etc.)
      country TEXT NOT NULL DEFAULT 'Switzerland',
      city TEXT,
      logo BYTEA,
      logo_mime TEXT DEFAULT 'image/png',
      is_internal BOOLEAN DEFAULT FALSE,
      settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  log('  Table companies créée/vérifiée', 'success');

  // 1.2 Table sites (avec company_id)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT, -- Code court (ex: NYN, PRG, etc.)
      address TEXT,
      city TEXT,
      country TEXT DEFAULT 'Switzerland',
      timezone TEXT DEFAULT 'Europe/Zurich',
      is_active BOOLEAN DEFAULT TRUE,
      settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(company_id, name),
      UNIQUE(company_id, code)
    )
  `);
  log('  Table sites créée/vérifiée', 'success');

  // 1.3 Ajouter company_id à sites si pas présent (migration)
  await addColumnIfNotExists('sites', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE CASCADE');

  // 1.4 Table departments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(company_id, code)
    )
  `);
  log('  Table departments créée/vérifiée', 'success');

  // 1.5 Table users avec permissions multi-tenant
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      name TEXT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      role TEXT DEFAULT 'site', -- 'site', 'global', 'admin', 'superadmin'
      allowed_apps TEXT[] DEFAULT NULL, -- NULL = tous les apps, [] = aucun, ['atex', 'switchboard'] = liste
      is_active BOOLEAN DEFAULT TRUE,
      is_admin BOOLEAN DEFAULT FALSE,
      origin TEXT DEFAULT 'manual', -- 'manual', 'bubble', 'sso'
      preferences JSONB DEFAULT '{}'::jsonb,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  log('  Table users créée/vérifiée', 'success');

  // 1.6 Ajouter les colonnes manquantes à users
  await addColumnIfNotExists('users', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL');
  await addColumnIfNotExists('users', 'site_id', 'INTEGER REFERENCES sites(id) ON DELETE SET NULL');
  await addColumnIfNotExists('users', 'role', "TEXT DEFAULT 'site'");
  await addColumnIfNotExists('users', 'allowed_apps', 'TEXT[] DEFAULT NULL');
  await addColumnIfNotExists('users', 'is_admin', 'BOOLEAN DEFAULT FALSE');
  await addColumnIfNotExists('users', 'origin', "TEXT DEFAULT 'manual'");
  await addColumnIfNotExists('users', 'preferences', "JSONB DEFAULT '{}'::jsonb");

  // 1.7 Index pour la performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sites_company ON sites(company_id);
    CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
    CREATE INDEX IF NOT EXISTS idx_users_site ON users(site_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
    CREATE INDEX IF NOT EXISTS idx_departments_site ON departments(site_id);
  `);
  log('  Index créés', 'success');
}

// =============================================================================
// ÉTAPE 2: Créer Haleon + Nyon comme données de base
// =============================================================================

async function step2_CreateHaleonNyon() {
  log('ÉTAPE 2: Création de Haleon/Nyon', 'step');

  // 2.1 Créer l'entreprise Haleon
  const haleonResult = await pool.query(`
    INSERT INTO companies (name, code, country, city, is_internal)
    VALUES ('Haleon', 'HAL', 'Switzerland', 'Nyon', TRUE)
    ON CONFLICT (name) DO UPDATE SET
      code = EXCLUDED.code,
      is_internal = TRUE
    RETURNING id
  `);
  const haleonId = haleonResult.rows[0].id;
  log(`  Entreprise Haleon créée/mise à jour (id=${haleonId})`, 'success');

  // 2.2 Créer le site Nyon
  const nyonResult = await pool.query(`
    INSERT INTO sites (company_id, name, code, city, country)
    VALUES ($1, 'Nyon', 'NYN', 'Nyon', 'Switzerland')
    ON CONFLICT (company_id, name) DO UPDATE SET
      code = EXCLUDED.code
    RETURNING id
  `, [haleonId]);
  const nyonId = nyonResult.rows[0].id;
  log(`  Site Nyon créé/mis à jour (id=${nyonId})`, 'success');

  // 2.3 Créer le site "Global" pour supervision entreprise
  const globalResult = await pool.query(`
    INSERT INTO sites (company_id, name, code, city, country, settings)
    VALUES ($1, 'Global', 'GLB', 'Nyon', 'Switzerland', '{"isGlobalView": true}'::jsonb)
    ON CONFLICT (company_id, name) DO UPDATE SET
      code = EXCLUDED.code,
      settings = '{"isGlobalView": true}'::jsonb
    RETURNING id
  `, [haleonId]);
  const globalId = globalResult.rows[0].id;
  log(`  Site Global créé/mis à jour (id=${globalId})`, 'success');

  // 2.4 Créer un département Engineering par défaut
  await pool.query(`
    INSERT INTO departments (company_id, site_id, code, name)
    VALUES ($1, $2, 'ENG', 'Engineering')
    ON CONFLICT (company_id, code) DO NOTHING
  `, [haleonId, nyonId]);
  log('  Département Engineering créé', 'success');

  return { haleonId, nyonId, globalId };
}

// =============================================================================
// ÉTAPE 3: Ajouter company_id aux tables qui ont déjà site TEXT
// =============================================================================

async function step3_AddCompanyIdToTablesWithSite(haleonId, nyonId) {
  log('ÉTAPE 3: Ajout de company_id aux tables avec site TEXT', 'step');

  for (const config of TABLES_WITH_SITE_TEXT) {
    const exists = await tableExists(config.table);
    if (!exists) {
      log(`  Table ${config.table} n'existe pas, ignorée`, 'warning');
      continue;
    }

    // Ajouter company_id
    const added = await addColumnIfNotExists(config.table, 'company_id', 'INTEGER');

    // Ajouter site_id (référence à sites.id)
    await addColumnIfNotExists(config.table, 'site_id', 'INTEGER');

    // Migrer les données existantes vers Haleon/Nyon
    // Pour les enregistrements avec site='Nyon', définir company_id=haleonId, site_id=nyonId
    const updateResult = await pool.query(`
      UPDATE ${config.table}
      SET company_id = $1, site_id = $2
      WHERE company_id IS NULL
    `, [haleonId, nyonId]);

    if (updateResult.rowCount > 0) {
      log(`  ${config.table}: ${updateResult.rowCount} enregistrements migrés vers Haleon/Nyon`, 'success');
    }

    // Créer index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${config.table}_company ON ${config.table}(company_id);
      CREATE INDEX IF NOT EXISTS idx_${config.table}_site_id ON ${config.table}(site_id);
    `).catch(() => {});
  }
}

// =============================================================================
// ÉTAPE 4: Ajouter company_id ET site_id aux tables sans isolation
// =============================================================================

async function step4_AddTenantColumnsToTablesWithoutSite(haleonId, nyonId) {
  log('ÉTAPE 4: Ajout de company_id/site_id aux tables sans isolation', 'step');

  for (const tableName of TABLES_WITHOUT_SITE) {
    const exists = await tableExists(tableName);
    if (!exists) {
      log(`  Table ${tableName} n'existe pas, ignorée`, 'warning');
      continue;
    }

    // Ajouter company_id
    await addColumnIfNotExists(tableName, 'company_id', 'INTEGER');

    // Ajouter site_id
    await addColumnIfNotExists(tableName, 'site_id', 'INTEGER');

    // Migrer les données existantes vers Haleon/Nyon
    const updateResult = await pool.query(`
      UPDATE ${tableName}
      SET company_id = $1, site_id = $2
      WHERE company_id IS NULL
    `, [haleonId, nyonId]);

    if (updateResult.rowCount > 0) {
      log(`  ${tableName}: ${updateResult.rowCount} enregistrements migrés vers Haleon/Nyon`, 'success');
    }

    // Créer index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company_id);
      CREATE INDEX IF NOT EXISTS idx_${tableName}_site_id ON ${tableName}(site_id);
    `).catch(() => {});
  }
}

// =============================================================================
// ÉTAPE 5: Migrer les utilisateurs existants vers Haleon
// =============================================================================

async function step5_MigrateUsers(haleonId, nyonId) {
  log('ÉTAPE 5: Migration des utilisateurs vers Haleon/Nyon', 'step');

  // Mettre à jour tous les utilisateurs @haleon.com
  const result = await pool.query(`
    UPDATE users
    SET company_id = $1, site_id = $2, role = COALESCE(role, 'site')
    WHERE email LIKE '%@haleon.com'
    AND company_id IS NULL
  `, [haleonId, nyonId]);

  log(`  ${result.rowCount} utilisateurs Haleon migrés`, 'success');

  // Migrer aussi depuis haleon_users si cette table existe
  const haleonUsersExists = await tableExists('haleon_users');
  if (haleonUsersExists) {
    const syncResult = await pool.query(`
      INSERT INTO users (email, name, company_id, site_id, role, origin)
      SELECT h.email, h.name, $1, COALESCE(h.site_id, $2), 'site', 'bubble'
      FROM haleon_users h
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = h.email)
    `, [haleonId, nyonId]);
    log(`  ${syncResult.rowCount} utilisateurs synchronisés depuis haleon_users`, 'success');
  }

  // Migrer depuis askv_users si existe
  const askvUsersExists = await tableExists('askv_users');
  if (askvUsersExists) {
    const askvResult = await pool.query(`
      INSERT INTO users (email, company_id, site_id, role, origin)
      SELECT DISTINCT email, $1, $2, 'site', 'askveeva'
      FROM askv_users
      WHERE email LIKE '%@haleon.com'
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = askv_users.email)
    `, [haleonId, nyonId]);
    log(`  ${askvResult.rowCount} utilisateurs synchronisés depuis askv_users`, 'success');
  }
}

// =============================================================================
// ÉTAPE 6: Créer les vues de permission
// =============================================================================

async function step6_CreatePermissionHelpers() {
  log('ÉTAPE 6: Création des helpers de permission', 'step');

  // Fonction SQL pour obtenir les sites accessibles par un utilisateur
  await pool.query(`
    CREATE OR REPLACE FUNCTION get_user_accessible_sites(user_id INTEGER)
    RETURNS TABLE(site_id INTEGER) AS $$
    DECLARE
      user_role TEXT;
      user_company_id INTEGER;
      user_site_id INTEGER;
    BEGIN
      -- Récupérer les infos de l'utilisateur
      SELECT role, company_id, u.site_id INTO user_role, user_company_id, user_site_id
      FROM users u WHERE u.id = user_id;

      -- Superadmin: tous les sites
      IF user_role = 'superadmin' THEN
        RETURN QUERY SELECT s.id FROM sites s;
        RETURN;
      END IF;

      -- Admin ou Global: tous les sites de son entreprise
      IF user_role IN ('admin', 'global') THEN
        RETURN QUERY SELECT s.id FROM sites s WHERE s.company_id = user_company_id;
        RETURN;
      END IF;

      -- Site: uniquement son site
      RETURN QUERY SELECT user_site_id;
    END;
    $$ LANGUAGE plpgsql;
  `);
  log('  Fonction get_user_accessible_sites créée', 'success');

  // Fonction pour vérifier l'accès à un site
  await pool.query(`
    CREATE OR REPLACE FUNCTION can_access_site(user_id INTEGER, target_site_id INTEGER)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM get_user_accessible_sites(user_id) WHERE site_id = target_site_id
      );
    END;
    $$ LANGUAGE plpgsql;
  `);
  log('  Fonction can_access_site créée', 'success');

  // Fonction pour obtenir la condition WHERE de filtrage
  await pool.query(`
    CREATE OR REPLACE FUNCTION get_tenant_filter(user_id INTEGER)
    RETURNS TEXT AS $$
    DECLARE
      user_role TEXT;
      user_company_id INTEGER;
      user_site_id INTEGER;
    BEGIN
      SELECT role, company_id, u.site_id INTO user_role, user_company_id, user_site_id
      FROM users u WHERE u.id = user_id;

      IF user_role = 'superadmin' THEN
        RETURN '1=1'; -- Pas de filtre
      END IF;

      IF user_role IN ('admin', 'global') THEN
        RETURN 'company_id = ' || user_company_id;
      END IF;

      RETURN 'site_id = ' || user_site_id;
    END;
    $$ LANGUAGE plpgsql;
  `);
  log('  Fonction get_tenant_filter créée', 'success');
}

// =============================================================================
// ÉTAPE 7: Rapport final
// =============================================================================

async function step7_GenerateReport() {
  log('ÉTAPE 7: Rapport de migration', 'step');

  // Compter les enregistrements par table
  const tables = [...TABLES_WITH_SITE_TEXT.map(t => t.table), ...TABLES_WITHOUT_SITE];

  console.log('\n📊 RAPPORT DE MIGRATION\n');
  console.log('=' .repeat(60));

  let totalRecords = 0;
  let migratedRecords = 0;

  for (const tableName of tables) {
    const exists = await tableExists(tableName);
    if (!exists) continue;

    try {
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM ${tableName}`);
      const migratedResult = await pool.query(`
        SELECT COUNT(*) as migrated FROM ${tableName} WHERE company_id IS NOT NULL
      `);

      const total = parseInt(countResult.rows[0].total);
      const migrated = parseInt(migratedResult.rows[0].migrated);

      if (total > 0) {
        totalRecords += total;
        migratedRecords += migrated;
        console.log(`${tableName.padEnd(35)} ${String(migrated).padStart(6)} / ${String(total).padStart(6)}`);
      }
    } catch (e) {
      // Table existe mais pas de company_id encore
    }
  }

  console.log('=' .repeat(60));
  console.log(`TOTAL${' '.repeat(30)} ${String(migratedRecords).padStart(6)} / ${String(totalRecords).padStart(6)}`);
  console.log('');

  // Statistiques companies/sites
  const companiesCount = await pool.query('SELECT COUNT(*) FROM companies');
  const sitesCount = await pool.query('SELECT COUNT(*) FROM sites');
  const usersCount = await pool.query('SELECT COUNT(*) FROM users WHERE company_id IS NOT NULL');

  console.log('📈 STATISTIQUES:');
  console.log(`   Entreprises: ${companiesCount.rows[0].count}`);
  console.log(`   Sites: ${sitesCount.rows[0].count}`);
  console.log(`   Utilisateurs avec company: ${usersCount.rows[0].count}`);
  console.log('');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('');
  console.log('🏢 MIGRATION MULTI-TENANT ELECTROHUB');
  console.log('=====================================');
  console.log('');

  try {
    // Test connexion
    await pool.query('SELECT 1');
    log('Connexion à la base de données établie', 'success');
    console.log('');

    // Exécution des étapes
    await step1_CreateBaseTables();
    console.log('');

    const { haleonId, nyonId, globalId } = await step2_CreateHaleonNyon();
    console.log('');

    await step3_AddCompanyIdToTablesWithSite(haleonId, nyonId);
    console.log('');

    await step4_AddTenantColumnsToTablesWithoutSite(haleonId, nyonId);
    console.log('');

    await step5_MigrateUsers(haleonId, nyonId);
    console.log('');

    await step6_CreatePermissionHelpers();
    console.log('');

    await step7_GenerateReport();

    console.log('🎉 MIGRATION TERMINÉE AVEC SUCCÈS!');
    console.log('');
    console.log('📋 PROCHAINES ÉTAPES:');
    console.log('   1. Mettre à jour les APIs backend pour filtrer par company_id/site_id');
    console.log('   2. Tester les permissions Global/Site');
    console.log('   3. Déployer sur Render');
    console.log('');

  } catch (error) {
    log(`Erreur: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
