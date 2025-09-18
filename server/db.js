import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
