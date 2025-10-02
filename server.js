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

// ---- PROXY ATEX (avant parsing corps)
const atexTarget = process.env.ATEX_BASE_URL || 'http://127.0.0.1:3001';
app.use('/api/atex', createProxyMiddleware({ target: atexTarget, changeOrigin: true, logLevel: 'warn' }));

// ---- PROXY LOOPCALC
const loopTarget = process.env.LOOPCALC_BASE_URL || 'http://127.0.0.1:3002';
app.use('/api/loopcalc', createProxyMiddleware({ target: loopTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY SWITCHBOARD
const switchboardTarget = process.env.SWITCHBOARD_BASE_URL || 'http://127.0.0.1:3003';
app.use('/api/switchboard', createProxyMiddleware({ target: switchboardTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY SELECTIVITY
const selectivityTarget = process.env.SELECTIVITY_BASE_URL || 'http://127.0.0.1:3004';
app.use('/api/selectivity', createProxyMiddleware({ target: selectivityTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY FLA
const flaTarget = process.env.FLA_BASE_URL || 'http://127.0.0.1:3005';
app.use('/api/faultlevel', createProxyMiddleware({ target: flaTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY ARCFLASH
const arcflashTarget = process.env.ARCFLASH_BASE_URL || 'http://127.0.0.1:3006';
app.use('/api/arcflash', createProxyMiddleware({ target: arcflashTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY OBSOLESCENCE
const obsolescenceTarget = process.env.OBSOLESCENCE_BASE_URL || 'http://127.0.0.1:3007';
app.use('/api/obsolescence', createProxyMiddleware({ target: obsolescenceTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY HV
const hvTarget = process.env.HV_BASE_URL || 'http://127.0.0.1:3009';
app.use('/api/hv', createProxyMiddleware({ target: hvTarget, changeOrigin: true, logLevel: 'debug' }));

// --- PROXY DIAGRAM
const diagramTarget = process.env.DIAGRAM_BASE_URL || 'http://127.0.0.1:3010';
app.use('/api/diagram', createProxyMiddleware({ target: diagramTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY CONTROLS
const controlsTarget = process.env.CONTROLS_BASE_URL || 'http://127.0.0.1:3011';
app.use('/api/controls', createProxyMiddleware({ target: controlsTarget, changeOrigin: true, logLevel: 'warn' }));

// --- PROXY OIBT (NOUVEAU)
const oibtTarget = process.env.OIBT_BASE_URL || 'http://127.0.0.1:3012';
app.use('/api/oibt', createProxyMiddleware({ target: oibtTarget, changeOrigin: true, logLevel: 'warn' }));

// ---- Parsers (après les proxies)
app.use(express.json());
app.use(cookieParser());

// ---- CORS (routes servies par ce serveur)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Health
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
