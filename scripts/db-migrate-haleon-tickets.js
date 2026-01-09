// scripts/db-migrate-haleon-tickets.js
// Migration pour l'intégration des tickets Haleon Tool
// Usage: DATABASE_URL="..." node scripts/db-migrate-haleon-tickets.js

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
  console.log('🚀 Migration Haleon Tickets - Démarrage...\n');

  try {
    // 1. Table de mapping : Équipes Haleon → Apps ElectroHub
    console.log('1️⃣ Création de la table haleon_ticket_group_mapping...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_group_mapping (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        haleon_group_id VARCHAR(255),
        haleon_group_name VARCHAR(255) NOT NULL UNIQUE,
        electrohub_apps TEXT[] NOT NULL DEFAULT '{}',
        color VARCHAR(50),
        icon_url TEXT,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   ✅ Table haleon_ticket_group_mapping créée\n');

    // 2. Insérer les mappings par défaut
    console.log('2️⃣ Insertion des mappings par défaut...');

    const defaultMappings = [
      {
        name: 'Elec',
        apps: ['switchboards', 'hv', 'obsolescence', 'selectivity', 'fault-level', 'arc-flash', 'loopcalc'],
        color: '#DFF0FF',
        description: 'Équipe Électricité - Maintenance électrique, tableaux, haute tension'
      },
      {
        name: 'Thermistes',
        apps: ['meca', 'vsd'],
        color: '#F4F0EE',
        description: 'Équipe Thermistes - HVAC, chauffage, ventilation'
      },
      {
        name: 'Technicien Facility',
        apps: ['meca', 'mobile-equipments', 'glo'],
        color: '#F0F4FF',
        description: 'Techniciens Facility - Réparations, déplacements, aménagements'
      },
      {
        name: 'Infra',
        apps: ['infrastructure'],
        color: '#fbe2cf',
        description: 'Infrastructure - Maintenance bâtiment, espaces verts'
      },
      {
        name: 'Consignation',
        apps: ['switchboards', 'hv'],
        color: '#FA8072',
        description: 'Consignation - Consignation électrique et utilités'
      },
      {
        name: 'Employee Experience et Services',
        apps: ['doors', 'fire-control'],
        color: '#E8F5F6',
        description: 'Employee Experience - Meeting rooms, restauration'
      },
      {
        name: 'Haleon-tool Support',
        apps: ['*'],
        color: '#E9967A',
        description: 'Support Haleon-Tool - Accès à tous les tickets'
      },
      {
        name: 'Softservice',
        apps: ['glo', 'mobile-equipments'],
        color: '#FFEDE3',
        description: 'Softservice - EPI, consommables, accessoires IT'
      },
      {
        name: 'Cleaning',
        apps: [],
        color: '#F8F2E2',
        description: 'Cleaning - Nettoyage'
      },
      {
        name: 'Waste',
        apps: [],
        color: '#F2F5E5',
        description: 'Waste - Gestion des déchets'
      },
      {
        name: 'My Greenshop',
        apps: [],
        color: '#F08080',
        description: 'My Greenshop - Machines café, fontaines à eau'
      }
    ];

    for (const mapping of defaultMappings) {
      await pool.query(`
        INSERT INTO haleon_ticket_group_mapping (haleon_group_name, electrohub_apps, color, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (haleon_group_name) DO UPDATE SET
          electrohub_apps = EXCLUDED.electrohub_apps,
          color = EXCLUDED.color,
          description = EXCLUDED.description,
          updated_at = NOW()
      `, [mapping.name, mapping.apps, mapping.color, mapping.description]);
    }
    console.log(`   ✅ ${defaultMappings.length} mappings insérés\n`);

    // 3. Table de cache des tickets
    console.log('3️⃣ Création de la table haleon_tickets_cache...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_tickets_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL UNIQUE,
        ticket_code VARCHAR(50),
        title VARCHAR(500),
        description TEXT,
        status VARCHAR(100),
        status_normalized VARCHAR(50),
        priority VARCHAR(50),
        priority_normalized VARCHAR(50),
        haleon_group_name VARCHAR(255),
        category_name VARCHAR(255),
        building VARCHAR(255),
        floor VARCHAR(255),
        zone VARCHAR(255),
        created_by_email VARCHAR(255),
        assigned_to_email VARCHAR(255),
        bubble_created_at TIMESTAMPTZ,
        bubble_updated_at TIMESTAMPTZ,
        date_attribution TIMESTAMPTZ,
        date_cloture TIMESTAMPTZ,
        devis_id VARCHAR(255),
        raw_data JSONB,
        last_sync_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_group ON haleon_tickets_cache(haleon_group_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_status ON haleon_tickets_cache(status_normalized)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_assigned ON haleon_tickets_cache(assigned_to_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_created_by ON haleon_tickets_cache(created_by_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_priority ON haleon_tickets_cache(priority_normalized)`);
    console.log('   ✅ Table haleon_tickets_cache créée avec index\n');

    // 4. Table des actions (logs)
    console.log('4️⃣ Création de la table haleon_ticket_actions...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        performed_by_email VARCHAR(255) NOT NULL,
        performed_by_name VARCHAR(255),
        action_data JSONB,
        sync_status VARCHAR(50) DEFAULT 'pending',
        sync_error TEXT,
        bubble_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        synced_at TIMESTAMPTZ
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_actions_ticket ON haleon_ticket_actions(bubble_ticket_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_actions_user ON haleon_ticket_actions(performed_by_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_actions_sync ON haleon_ticket_actions(sync_status)`);
    console.log('   ✅ Table haleon_ticket_actions créée avec index\n');

    // 5. Table de configuration globale
    console.log('5️⃣ Création de la table haleon_tickets_config...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_tickets_config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) NOT NULL UNIQUE,
        value JSONB,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Insérer la config par défaut
    const defaultConfig = [
      {
        key: 'sync_interval_minutes',
        value: 5,
        description: 'Intervalle de synchronisation en minutes'
      },
      {
        key: 'statuses_to_show',
        value: ['Ouvert (En attente d\'attribution)', 'Ouvert (Attribué)', 'Ouvert (Demande de Devis)'],
        description: 'Statuts de tickets à afficher'
      },
      {
        key: 'priority_mapping',
        value: {
          'LOW': { normalized: 'low', label: 'Faible', color: '#22c55e', order: 1 },
          'MEDIUM': { normalized: 'medium', label: 'Normale', color: '#3b82f6', order: 2 },
          'HIGH': { normalized: 'high', label: 'Haute', color: '#f97316', order: 3 },
          'URGENT': { normalized: 'urgent', label: 'Urgente', color: '#ef4444', order: 4 },
          'Safety': { normalized: 'safety', label: 'Sécurité', color: '#dc2626', order: 5 }
        },
        description: 'Mapping des priorités Bubble → ElectroHub'
      },
      {
        key: 'status_mapping',
        value: {
          'Ouvert (En attente d\'attribution)': { normalized: 'unassigned', label: 'Non attribué', color: '#ef4444' },
          'Ouvert (Attribué)': { normalized: 'assigned', label: 'Attribué', color: '#f97316' },
          'Ouvert (Demande de Devis)': { normalized: 'quote_pending', label: 'Devis en attente', color: '#eab308' },
          'Fermé': { normalized: 'closed', label: 'Fermé', color: '#22c55e' }
        },
        description: 'Mapping des statuts Bubble → ElectroHub'
      },
      {
        key: 'bubble_api_url',
        value: 'https://haleon-tool.io/api/1.1',
        description: 'URL de base de l\'API Bubble'
      },
      {
        key: 'last_sync_at',
        value: null,
        description: 'Dernière synchronisation réussie'
      }
    ];

    for (const config of defaultConfig) {
      await pool.query(`
        INSERT INTO haleon_tickets_config (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [config.key, JSON.stringify(config.value), config.description]);
    }
    console.log('   ✅ Configuration par défaut insérée\n');

    console.log('✅ Migration Haleon Tickets terminée avec succès!\n');

    // Afficher un résumé
    const mappingCount = await pool.query('SELECT COUNT(*) FROM haleon_ticket_group_mapping');
    const configCount = await pool.query('SELECT COUNT(*) FROM haleon_tickets_config');

    console.log('📊 Résumé:');
    console.log(`   - ${mappingCount.rows[0].count} mappings de groupes`);
    console.log(`   - ${configCount.rows[0].count} configurations`);
    console.log('\n💡 Prochaines étapes:');
    console.log('   1. Configurer HALEON_TICKETS_API_KEY dans .env');
    console.log('   2. Redémarrer le serveur');
    console.log('   3. Tester l\'endpoint GET /api/haleon-tickets/test');

  } catch (error) {
    console.error('❌ Erreur de migration:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
