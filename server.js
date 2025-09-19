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

// Sécurité
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));

// CORS - AVANT TOUT
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// PROXY ATEX - APRÈS CORS
const atexTarget = process.env.ATEX_BASE_URL || 'http://127.0.0.1:3001';
app.use('/api/atex', createProxyMiddleware({
  target: atexTarget,
  changeOrigin: true,
  logLevel: 'warn',
  onProxyReq: (proxyReq, req, res) => {
    console.log('[PROXY DEBUG] Request headers:', Object.keys(req.headers));
    if (req.headers.authorization) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
      console.log('[PROXY DEBUG] Forwarding Authorization to ATEX: YES');
    } else {
      console.log('[PROXY DEBUG] NO Authorization header from client');
    }
  },
  secure: false,
}));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Helper pour mapper nom -> ID
async function getIdByName(table, nameField, nameValue) {
  const { rows } = await pool.query(`SELECT id FROM ${table} WHERE ${nameField} = $1`, [nameValue]);
  return rows[0]?.id;
}

// Middleware pour vérifier token et ajouter user à req
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET || 'dev', (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, site, department } = req.body;
  
  if (!name || !email || !password || !site || !department) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const site_id = await getIdByName('sites', 'name', site);
    const department_id = await getIdByName('departments', 'name', department);
    
    if (!site_id) return res.status(400).json({ error: `Invalid site: ${site}` });
    if (!department_id) return res.status(400).json({ error: `Invalid department: ${department}` });

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, site_id, department_id, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) 
       RETURNING id, email, name, site_id, department_id, created_at`,
      [email, password_hash, name, site_id, department_id]
    );

    const newUser = rows[0];
    
    const siteRes = await pool.query('SELECT name FROM sites WHERE id = $1', [newUser.site_id]);
    const deptRes = await pool.query('SELECT name FROM departments WHERE id = $1', [newUser.department_id]);
    
    const userInfo = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      site: siteRes.rows[0]?.name,
      department: deptRes.rows[0]?.name,
      site_id: newUser.site_id,
      department_id: newUser.department_id
    };

    const token = jwt.sign(userInfo, process.env.JWT_SECRET || 'dev', { expiresIn: '24h' });
    
    res.status(201).json({ 
      message: 'Account created successfully', 
      token,
      user: userInfo 
    });
  } catch (e) {
    console.error('[SIGNUP] error:', e);
    res.status(500).json({ error: 'Signup failed: ' + e.message });
  }
});

// Signin
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, name, site_id, department_id FROM users WHERE email = $1', 
      [email]
    );
    
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const siteRes = await pool.query('SELECT name FROM sites WHERE id = $1', [user.site_id]);
    const deptRes = await pool.query('SELECT name FROM departments WHERE id = $1', [user.department_id]);
    
    const userInfo = {
      id: user.id,
      email: user.email,
      name: user.name,
      site: siteRes.rows[0]?.name,
      department: deptRes.rows[0]?.name,
      site_id: user.site_id,
      department_id: user.department_id
    };

    const token = jwt.sign(userInfo, process.env.JWT_SECRET || 'dev', { expiresIn: '24h' });
    
    res.json({ 
      token, 
      user: userInfo,
      message: 'Login successful'
    });
  } catch (e) {
    console.error('[SIGNIN] error:', e);
    res.status(500).json({ error: 'Signin failed' });
  }
});

// Get current user
app.get('/api/auth/user', authenticateToken, async (req, res) => {
  try {
    res.json(req.user);
  } catch (e) {
    console.error('[USER] error:', e);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Lost password (placeholder)
app.post('/api/auth/lost-password', async (req, res) => {
  res.json({ message: 'Password reset link sent (feature coming soon)' });
});

// Static frontend
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
