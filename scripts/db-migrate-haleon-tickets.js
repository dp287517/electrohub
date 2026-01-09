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
    // 1. Table des équipes (importées depuis Bubble)
    console.log('1️⃣ Création de la table haleon_ticket_teams...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_team_id VARCHAR(255) UNIQUE,
        name VARCHAR(255) NOT NULL,
        color VARCHAR(50) DEFAULT '#3b82f6',
        site VARCHAR(100) DEFAULT 'Nyon',
        bubble_users TEXT[],
        is_active BOOLEAN DEFAULT TRUE,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_teams_name ON haleon_ticket_teams(name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_teams_active ON haleon_ticket_teams(is_active)`);
    console.log('   ✅ Table haleon_ticket_teams créée\n');

    // 2. Table des catégories de tickets (importées depuis Bubble)
    console.log('2️⃣ Création de la table haleon_ticket_categories...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_category_id VARCHAR(255) UNIQUE,
        name VARCHAR(255) NOT NULL,
        team_name VARCHAR(255),
        color VARCHAR(50) DEFAULT '#3b82f6',
        icon_url TEXT,
        site VARCHAR(100) DEFAULT 'Nyon',
        is_active BOOLEAN DEFAULT TRUE,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_categories_team ON haleon_ticket_categories(team_name)`);
    console.log('   ✅ Table haleon_ticket_categories créée\n');

    // 3. Table de liaison : Utilisateurs ElectroHub ↔ Équipes Haleon
    console.log('3️⃣ Création de la table haleon_ticket_team_members...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES haleon_ticket_teams(id) ON DELETE CASCADE,
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(255),
        can_assign BOOLEAN DEFAULT TRUE,
        can_close BOOLEAN DEFAULT TRUE,
        added_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, user_email)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_members_email ON haleon_ticket_team_members(user_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_members_team ON haleon_ticket_team_members(team_id)`);
    console.log('   ✅ Table haleon_ticket_team_members créée\n');

    // 4. Table de cache des tickets
    console.log('4️⃣ Création de la table haleon_tickets_cache...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_tickets_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL UNIQUE,
        ticket_code VARCHAR(50),
        description TEXT,
        status VARCHAR(100),
        status_normalized VARCHAR(50),
        priority VARCHAR(50),
        priority_normalized VARCHAR(50),
        category_name VARCHAR(255),
        team_name VARCHAR(255),
        building VARCHAR(255),
        floor VARCHAR(255),
        zone VARCHAR(255),
        created_by_email VARCHAR(255),
        created_by_name VARCHAR(255),
        assigned_to_email VARCHAR(255),
        assigned_to_name VARCHAR(255),
        bubble_created_at TIMESTAMPTZ,
        bubble_modified_at TIMESTAMPTZ,
        date_attribution TIMESTAMPTZ,
        date_cloture TIMESTAMPTZ,
        devis_id VARCHAR(255),
        zap_id VARCHAR(255),
        urgence_sla VARCHAR(50),
        raw_data JSONB,
        last_sync_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_team ON haleon_tickets_cache(team_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_status ON haleon_tickets_cache(status_normalized)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_assigned ON haleon_tickets_cache(assigned_to_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_created_by ON haleon_tickets_cache(created_by_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_priority ON haleon_tickets_cache(priority_normalized)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_code ON haleon_tickets_cache(ticket_code)`);
    console.log('   ✅ Table haleon_tickets_cache créée avec index\n');

    // 5. Table des actions (logs d'audit)
    console.log('5️⃣ Création de la table haleon_ticket_actions...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL,
        ticket_code VARCHAR(50),
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_actions_type ON haleon_ticket_actions(action_type)`);
    console.log('   ✅ Table haleon_ticket_actions créée avec index\n');

    // 6. Table de configuration globale
    console.log('6️⃣ Création de la table haleon_tickets_config...');
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
        description: 'Intervalle de synchronisation automatique en minutes'
      },
      {
        key: 'statuses_to_show',
        value: ['Ouvert (En attente d\'attribution)', 'Ouvert (Attribué)', 'Ouvert (Demande de Devis)'],
        description: 'Statuts de tickets à afficher dans ElectroHub'
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
          'Ouvert (En attente d\'attribution)': { normalized: 'unassigned', label: 'Non attribué', color: '#ef4444', icon: '🔴' },
          'Ouvert (Attribué)': { normalized: 'assigned', label: 'Attribué', color: '#f97316', icon: '🟠' },
          'Ouvert (Demande de Devis)': { normalized: 'quote_pending', label: 'Devis en attente', color: '#eab308', icon: '🟡' },
          'Fermé': { normalized: 'closed', label: 'Fermé', color: '#22c55e', icon: '🟢' }
        },
        description: 'Mapping des statuts Bubble → ElectroHub'
      },
      {
        key: 'bubble_api',
        value: {
          base_url: 'https://haleon-tool.io/api/1.1',
          data_url: 'https://haleon-tool.io/api/1.1/obj',
          workflow_url: 'https://haleon-tool.io/api/1.1/wf'
        },
        description: 'Configuration API Bubble'
      },
      {
        key: 'bubble_tables',
        value: {
          tickets: 'TICKET',
          categories: 'TICKET: Catégorie',
          teams: 'EquipeUser',
          actions: 'TICKET: ActionTICKET'
        },
        description: 'Noms des tables Bubble'
      },
      {
        key: 'last_teams_sync_at',
        value: null,
        description: 'Dernière synchronisation des équipes'
      },
      {
        key: 'last_tickets_sync_at',
        value: null,
        description: 'Dernière synchronisation des tickets'
      }
    ];

    for (const config of defaultConfig) {
      await pool.query(`
        INSERT INTO haleon_tickets_config (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          description = EXCLUDED.description,
          updated_at = NOW()
      `, [config.key, JSON.stringify(config.value), config.description]);
    }
    console.log('   ✅ Configuration par défaut insérée\n');

    console.log('✅ Migration Haleon Tickets terminée avec succès!\n');

    // Afficher un résumé
    console.log('📊 Tables créées:');
    console.log('   - haleon_ticket_teams (équipes importées de Bubble)');
    console.log('   - haleon_ticket_categories (catégories de tickets)');
    console.log('   - haleon_ticket_team_members (membres ElectroHub par équipe)');
    console.log('   - haleon_tickets_cache (cache local des tickets)');
    console.log('   - haleon_ticket_actions (audit des actions)');
    console.log('   - haleon_tickets_config (configuration)');

    console.log('\n💡 Prochaines étapes:');
    console.log('   1. Aller dans Admin → Équipes Haleon Tool');
    console.log('   2. Cliquer "Synchroniser depuis Bubble"');
    console.log('   3. Ajouter les utilisateurs ElectroHub aux équipes');

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
