import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

// Use env var on Render: NEON_DATABASE_URL
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// CORS (adjust if needed)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Placeholder auth (wire Neon later)
app.post('/api/auth/signup', async (req, res) => {
  // TODO: store user (email, password hash, name, site, department) in Neon
  return res.status(201).json({ message: 'Sign up placeholder' });
});

app.post('/api/auth/signin', async (req, res) => {
  // TODO: verify user & issue JWT
  const token = jwt.sign({ uid: 'demo', site: 'Nyon', department: 'Maintenance' }, process.env.JWT_SECRET || 'dev', { expiresIn: '2h' });
  return res.json({ token });
});

app.post('/api/auth/lost-password', async (req, res) => {
  // TODO: send reset email / token
  return res.json({ message: 'Reset link sent (placeholder)' });
});

// Serve frontend
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_, res) => res.sendFile(path.join(distPath, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
