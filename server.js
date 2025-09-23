// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { createProxyMiddleware } from 'http-proxy-middleware';

dotenv.config();
const { Pool } = pg;

// Connexion DB (utilisée si tu ajoutes des routes côté app principale)
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- Sécurité de base
app.use(helmet());

// ---- PROXY ATEX AVANT TOUT PARSING DU CORPS (important pour éviter 408/aborted)
const atexTarget = process.env.ATEX_BASE_URL || 'http://127.0.0.1:3001';
app.use(
  '/api/atex',
  createProxyMiddleware({
    target: atexTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// ---- PROXY LOOPCALC AVANT TOUT PARSING DU CORPS (même logique)
const loopTarget = process.env.LOOPCALC_BASE_URL || 'http://127.0.0.1:3002';
app.use(
  '/api/loopcalc',
  createProxyMiddleware({
    target: loopTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// --- PROXY SWITCHBOARD (place BEFORE body parsing like /api/atex & /api/loopcalc) ---
const switchboardTarget = process.env.SWITCHBOARD_BASE_URL || 'http://127.0.0.1:3003';
app.use(
  '/api/switchboard',
  createProxyMiddleware({
    target: switchboardTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// --- PROXY SELECTIVITY (AJOUT: place BEFORE body parsing) ---
const selectivityTarget = process.env.SELECTIVITY_BASE_URL || 'http://127.0.0.1:3004';
app.use(
  '/api/selectivity',
  createProxyMiddleware({
    target: selectivityTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// --- PROXY FLA (AJOUT: place BEFORE body parsing) ---
const flaTarget = process.env.FLA_BASE_URL || 'http://127.0.0.1:3005';
app.use(
  '/api/fla',
  createProxyMiddleware({
    target: flaTarget,
    changeOrigin: true,
    logLevel: 'warn',
  })
);

// ---- Parsers (après les proxies)
app.use(express.json());
app.use(cookieParser());

// ---- CORS (pour les routes servies par ce serveur-ci ;
// les routes /api/atex et /api/loopcalc gèrent déjà CORS côté services dédiés)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Health (mets bien /api/health dans Render)
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Auth placeholders
app.post('/api/auth/signup', async (_req, res) => res.status(201).json({ message: 'Sign up placeholder' }));
app.post('/api/auth/signin', async (_req, res) => {
  const token = jwt.sign(
    { uid: 'demo', site: 'Nyon', department: 'Maintenance' },
    process.env.JWT_SECRET || 'dev',
    { expiresIn: '2h' }
  );
  res.json({ token });
});
app.post('/api/auth/lost-password', async (_req, res) => res.json({ message: 'Reset link sent (placeholder)' }));

// ---- Static frontend
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ---- Start
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
