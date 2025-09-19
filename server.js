// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createProxyMiddleware } from 'http-proxy-middleware';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- Sécurité de base
app.use(helmet());

// ---- PROXY ATEX AVANT TOUT PARSING DU CORPS
const atexTarget = process.env.ATEX_BASE_URL || 'http://127.0.0.1:3001';
app.use(
  '/api/atex',
  createProxyMiddleware({
    target: atexTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// ---- Parsers (après le proxy)
app.use(express.json());
app.use(cookieParser());

// ---- CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET || 'dev', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ---- Health
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Users table (sûre - IF NOT EXISTS)
async function ensureUsersTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        site VARCHAR(100) NOT NULL,
        department VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');
  } catch (e) {
    console.error('❌ Table creation failed:', e);
  }
}
ensureUsersTable();

// ---- Auth routes avec fallback pour anciens comptes
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, site, department } = req.body;
    if (!name || !email || !password || !site || !department) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, site, department) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, site, department',
      [name, email.toLowerCase(), password_hash, site, department]
    );

    const user = rows[0];
    const token = jwt.sign(
      { uid: user.id, name: user.name, email: user.email, site: user.site, department: user.department },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    console.error('[SIGNUP] error:', e);
    res.status(500).json({ error: 'Sign up failed' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Cherche d'abord dans la nouvelle table users
    let { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    let user = rows[0];
    
    // Fallback pour anciens comptes (demo)
    if (!user) {
      // Utilise les anciennes credentials demo
      if (email === 'demo@electrohub.com' && password === 'demo123') {
        user = {
          id: 'demo',
          name: 'Demo User',
          email: email,
          site: 'Nyon',  // Fallback
          department: 'Maintenance'
        };
      } else {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      // Vérifie le mot de passe pour les nouveaux comptes
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { uid: user.id, name: user.name, email: user.email, site: user.site, department: user.department },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, site: user.site, department: user.department } });
  } catch (e) {
    console.error('[SIGNIN] error:', e);
    res.status(500).json({ error: 'Sign in failed' });
  }
});

app.post('/api/auth/lost-password', async (req, res) => {
  res.json({ message: 'Reset link sent (placeholder)' });
});

// ---- User profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  res.json(req.user);
});

// ---- Static frontend
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ---- Start
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
