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
app.use(express.json()); // JSON only; multipart is proxied as-is
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

/**
 * ---- Lightweight proxy to the ATEX microservice ----
 * Set ATEX_BASE to your ATEX backend URL (e.g., https://your-atex.onrender.com)
 * This preserves method, headers (incl. multipart), body, and returns raw bytes (for downloads).
 */
const ATEX_BASE = process.env.ATEX_BASE || '';

async function bufferBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

app.use('/api/atex', async (req, res) => {
  try {
    if (!ATEX_BASE) {
      return res.status(500).json({ error: 'ATEX_BASE not configured on server' });
    }

    // Forward full path/query as-is
    const targetUrl = `${ATEX_BASE}${req.originalUrl}`;
    const body = await bufferBody(req);

    // Forward headers (drop hop-by-hop)
    const fwdHeaders = { ...req.headers };
    delete fwdHeaders['host'];

    const fetchOpts = {
      method: req.method,
      headers: fwdHeaders,
      redirect: 'manual',
      body: body && body.length ? body : undefined,
    };

    const resp = await fetch(targetUrl, fetchOpts);

    // Buffer response so we can set headers like Content-Length
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);

    // Copy relevant headers
    const copyHeaders = ['content-type', 'content-disposition', 'cache-control', 'pragma', 'expires'];
    res.status(resp.status);
    for (const h of copyHeaders) {
      const v = resp.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  } catch (err) {
    console.error('ATEX proxy error:', err);
    return res.status(502).json({ error: 'ATEX proxy failed' });
  }
});
// ------------------------------------------------------

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Placeholder auth (wire Neon later)
app.post('/api/auth/signup', async (req, res) => {
  // TODO: store user (email, password hash, name, site, department) in Neon
  return res.status(201).json({ message: 'Sign up placeholder' });
});

app.post('/api/auth/signin', async (req, res) => {
  // TODO: verify user & issue JWT
  const token = jwt.sign(
    { uid: 'demo', site: 'Nyon', department: 'Maintenance' },
    process.env.JWT_SECRET || 'dev',
    { expiresIn: '2h' }
  );
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
