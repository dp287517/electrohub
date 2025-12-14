#!/usr/bin/env node
// scripts/db-explore.js
// Script pour explorer la base de données Neon et afficher sa structure
// Usage: node scripts/db-explore.js
// Ou avec une connection string: DATABASE_URL="postgresql://..." node scripts/db-explore.js

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('❌ Aucune connection string trouvée.');
  console.error('   Définissez DATABASE_URL ou NEON_DATABASE_URL');
  console.error('   Exemple: DATABASE_URL="postgresql://user:pass@host/db" node scripts/db-explore.js');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function explore() {
  console.log('🔍 Connexion à la base de données...\n');

  try {
    // Test de connexion
    await pool.query('SELECT 1');
    console.log('✅ Connexion réussie!\n');

    // 1. Liste des tables avec nombre de lignes
    console.log('═'.repeat(60));
    console.log('📊 TABLES DE LA BASE DE DONNÉES');
    console.log('═'.repeat(60));

    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tableStats = [];
    for (const row of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${row.table_name}"`);
        tableStats.push({
          name: row.table_name,
          rows: parseInt(countResult.rows[0].count)
        });
      } catch (e) {
        tableStats.push({ name: row.table_name, rows: -1, error: e.message });
      }
    }

    // Trier par nombre de lignes
    tableStats.sort((a, b) => b.rows - a.rows);

    console.log('\nTable                                    | Lignes');
    console.log('-'.repeat(60));
    for (const t of tableStats) {
      const name = t.name.padEnd(40);
      const rows = t.rows >= 0 ? t.rows.toString() : `Error: ${t.error}`;
      console.log(`${name} | ${rows}`);
    }

    // 2. Détails de chaque table
    console.log('\n' + '═'.repeat(60));
    console.log('📋 STRUCTURE DES TABLES');
    console.log('═'.repeat(60));

    for (const t of tableStats) {
      console.log(`\n▶ TABLE: ${t.name} (${t.rows} lignes)`);
      console.log('-'.repeat(50));

      // Colonnes
      const colsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [t.name]);

      for (const col of colsResult.rows) {
        const nullable = col.is_nullable === 'YES' ? '?' : '';
        const defaultVal = col.column_default ? ` = ${col.column_default.substring(0, 30)}` : '';
        console.log(`  • ${col.column_name}: ${col.data_type}${nullable}${defaultVal}`);
      }

      // Exemple de données (3 premières lignes)
      if (t.rows > 0) {
        try {
          const sampleResult = await pool.query(`SELECT * FROM "${t.name}" LIMIT 3`);
          if (sampleResult.rows.length > 0) {
            console.log(`\n  📄 Exemple de données (${Math.min(3, t.rows)} lignes):`);
            for (const row of sampleResult.rows) {
              // Tronquer les valeurs longues
              const truncated = {};
              for (const [key, value] of Object.entries(row)) {
                if (value === null) {
                  truncated[key] = null;
                } else if (typeof value === 'string' && value.length > 50) {
                  truncated[key] = value.substring(0, 47) + '...';
                } else {
                  truncated[key] = value;
                }
              }
              console.log(`     ${JSON.stringify(truncated)}`);
            }
          }
        } catch (e) {
          console.log(`  ⚠️ Erreur lecture données: ${e.message}`);
        }
      }
    }

    // 3. Recherche spécifique de tables utilisateurs/auth
    console.log('\n' + '═'.repeat(60));
    console.log('👤 TABLES LIÉES AUX UTILISATEURS');
    console.log('═'.repeat(60));

    const userTables = tableStats.filter(t =>
      t.name.toLowerCase().includes('user') ||
      t.name.toLowerCase().includes('account') ||
      t.name.toLowerCase().includes('member') ||
      t.name.toLowerCase().includes('auth') ||
      t.name.toLowerCase().includes('employee') ||
      t.name.toLowerCase().includes('person')
    );

    if (userTables.length > 0) {
      for (const t of userTables) {
        console.log(`\n✅ ${t.name} (${t.rows} lignes)`);
      }
    } else {
      console.log('\n⚠️ Aucune table utilisateur évidente trouvée');
    }

    // 4. Recherche de tables entreprises/sites
    console.log('\n' + '═'.repeat(60));
    console.log('🏢 TABLES LIÉES AUX ENTREPRISES/SITES');
    console.log('═'.repeat(60));

    const orgTables = tableStats.filter(t =>
      t.name.toLowerCase().includes('compan') ||
      t.name.toLowerCase().includes('site') ||
      t.name.toLowerCase().includes('location') ||
      t.name.toLowerCase().includes('building') ||
      t.name.toLowerCase().includes('department') ||
      t.name.toLowerCase().includes('org') ||
      t.name.toLowerCase().includes('haleon')
    );

    if (orgTables.length > 0) {
      for (const t of orgTables) {
        console.log(`\n✅ ${t.name} (${t.rows} lignes)`);
      }
    } else {
      console.log('\n⚠️ Aucune table organisation évidente trouvée');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Exploration terminée!');
    console.log('═'.repeat(60));

  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    await pool.end();
  }
}

explore();
