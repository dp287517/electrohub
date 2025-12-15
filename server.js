// server.js — version 3.0 avec timeouts proxy robustes
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createProxyMiddleware } from "http-proxy-middleware";
import switchboardMapApp from "./server_switchboard_map.js";
import adminRouter from "./server_admin.js";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ============================================================
// AUTH AUDIT LOG - Traçage des connexions/déconnexions
// ============================================================
async function ensureAuthAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id SERIAL PRIMARY KEY,
        ts TIMESTAMPTZ DEFAULT NOW(),
        action TEXT NOT NULL,
        email TEXT,
        user_name TEXT,
        user_id INTEGER,
        company_id INTEGER,
        site_id INTEGER,
        role TEXT,
        source TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        details JSONB DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(email);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_log(action);
    `);
    console.log('[AUTH] Audit table ready');
  } catch (e) {
    console.error('[AUTH] Audit table error:', e.message);
  }
}
ensureAuthAuditTable();

async function logAuthEvent(req, action, data = {}) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(`
      INSERT INTO auth_audit_log (action, email, user_name, user_id, company_id, site_id, role, source, ip_address, user_agent, success, error_message, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      action,
      data.email || null,
      data.name || null,
      data.user_id || null,
      data.company_id || null,
      data.site_id || null,
      data.role || null,
      data.source || 'unknown',
      ip,
      userAgent,
      data.success !== false,
      data.error || null,
      JSON.stringify(data.details || {})
    ]);
  } catch (e) {
    console.error('[AUTH AUDIT] Log failed:', e.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Sécurité & cookies
app.use(helmet());
app.use(cookieParser());

// ⚠️ NOTE: switchboardMapApp a un body-parser qui parse TOUS les bodies AVANT les proxies.
// C'est pour ça que les proxies avec PUT/POST doivent utiliser withRestream: true
// pour re-transmettre le body parsé au microservice.
app.use(switchboardMapApp);

// -------- AUTH LIGHT (n'a pas besoin du body pour passer) ----------
function authMiddleware(req, _res, next) {
  if (req.path.startsWith("/api/auth/") || req.path.startsWith("/api/public/")) return next();
  const token = req.cookies?.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || "devsecret"); } catch {}
  next();
}
app.use(authMiddleware);

/* =================================================================
   PROXIES AVANT TOUT BODY-PARSER  => évite que le body soit mangé
   VERSION 3.0: Ajout de timeouts stricts pour éviter les blocages
   ================================================================= */
const atexTarget         = process.env.ATEX_BASE_URL         || "http://127.0.0.1:3001";
const loopcalcTarget     = process.env.LOOPCALC_BASE_URL      || "http://127.0.0.1:3002";
const switchboardTarget  = process.env.SWITCHBOARD_BASE_URL   || "http://127.0.0.1:3003";
const selectivityTarget  = process.env.SELECTIVITY_BASE_URL   || "http://127.0.0.1:3004";
const flaTarget          = process.env.FLA_BASE_URL           || "http://127.0.0.1:3005";
const arcflashTarget     = process.env.ARCFLASH_BASE_URL      || "http://127.0.0.1:3006";
const obsolescenceTarget = process.env.OBSOLESCENCE_BASE_URL  || "http://127.0.0.1:3007";
const hvTarget           = process.env.HV_BASE_URL            || "http://127.0.0.1:3008";
const diagramTarget      = process.env.DIAGRAM_BASE_URL       || "http://127.0.0.1:3009";
// Controls ancien système supprimé - remplacé par switchboard-controls intégré à server_switchboard.js
// const controlsTarget     = process.env.CONTROLS_BASE_URL      || "http://127.0.0.1:3011";
const oibtTarget         = process.env.OIBT_BASE_URL          || "http://127.0.0.1:3012";
const projectsTarget     = process.env.PROJECTS_BASE_URL      || "http://127.0.0.1:3013";
// 🔵 Comp-Ext (prestataires externes) — nouveau microservice sur 3014
const compExtTarget      = process.env.COMP_EXT_BASE_URL      || "http://127.0.0.1:3014";
// 🔵 Ask Veeva (lecture de documents + Q/R) — nouveau microservice sur 3015
const askVeevaTarget     = process.env.ASK_VEEVA_BASE_URL     || "http://127.0.0.1:3015";
// 🔵 Doors (portes coupe-feu) — microservice sur 3016  ✅ AJOUT
const doorsTarget        = process.env.DOORS_BASE_URL         || "http://127.0.0.1:3016";
// 🔵 VSD (Variateurs de fréquence) — microservice sur 3020  ✅ AJOUT
const vsdTarget          = process.env.VSD_BASE_URL           || "http://127.0.0.1:3020";
const mecaTarget = process.env.MECA_BASE_URL || "http://127.0.0.1:3021";
const dcfTarget = process.env.DCF_TARGET || "http://127.0.0.1:3030";
const learnExTarget = process.env.LEARN_EX_BASE_URL || "http://127.0.0.1:3040";

// ============================================================
// PROXY HELPER v3.0 - Avec timeouts stricts
// ============================================================
function mkProxy(target, { withRestream = false, timeoutMs = 20000 } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: "warn",

    // ✅ TIMEOUTS CRITIQUES pour éviter les blocages infinis
    proxyTimeout: timeoutMs,      // Timeout réponse backend (20s par défaut)
    timeout: timeoutMs + 5000,    // Timeout connexion total (25s par défaut)

    // ✅ Gestion d'erreur améliorée
    onError(err, req, res) {
      console.error(`[PROXY ERROR] ${req.method} ${req.path} -> ${target}: ${err.code || err.message}`);

      // Ne pas répondre si déjà envoyé
      if (res.headersSent) return;

      const isTimeout = err.code === 'ECONNRESET' ||
                       err.code === 'ETIMEDOUT' ||
                       err.code === 'ESOCKETTIMEDOUT' ||
                       err.message?.includes('timeout');

      if (isTimeout) {
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Timeout - le service met trop de temps à répondre",
          code: err.code || "TIMEOUT",
          retry: true
        }));
      } else {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Service temporairement indisponible",
          code: err.code || "UPSTREAM_ERROR",
          retry: true
        }));
      }
    },

    // Re-stream du body si déjà parsé en amont (sécurité)
    onProxyReq: withRestream
      ? (proxyReq, req) => {
          if (!req.body || !Object.keys(req.body).length) return;
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      : undefined,
  });
}

// ✅ ATEX: Ajout withRestream pour éviter les problèmes de body (setPosition, etc.)
app.use("/api/atex",         mkProxy(atexTarget, { withRestream: true, timeoutMs: 30000 }));
app.use("/api/loopcalc",     mkProxy(loopcalcTarget));
// ✅ SWITCHBOARD: Ajout withRestream pour éviter les problèmes de body
app.use("/api/switchboard",  mkProxy(switchboardTarget, { withRestream: true, timeoutMs: 25000 }));
app.use("/api/selectivity",  mkProxy(selectivityTarget));
app.use("/api/faultlevel",   mkProxy(flaTarget));
app.use("/api/arcflash",     mkProxy(arcflashTarget));
app.use("/api/obsolescence", mkProxy(obsolescenceTarget));
app.use("/api/hv",           mkProxy(hvTarget));
app.use("/api/diagram",      mkProxy(diagramTarget));
// Controls supprimé - switchboard-controls intégré à server_switchboard.js
// app.use("/api/controls",     mkProxy(controlsTarget));
app.use("/api/oibt",         mkProxy(oibtTarget));
app.use("/api/dcf", mkProxy(dcfTarget, { withRestream: true }));

// >>> Projects : proxy bavard + re-stream (si un jour body était déjà parsé)
app.use("/api/projects", mkProxy(projectsTarget, { withRestream: true }));

// >>> Comp-Ext (prestataires externes) : même traitement que Projects (re-stream utile pour PUT/POST)
app.use("/api/comp-ext", mkProxy(compExtTarget, { withRestream: true }));

// >>> Ask Veeva (ZIP + upload multipart) : re-stream INDISPENSABLE
app.use("/api/ask-veeva", mkProxy(askVeevaTarget, { withRestream: true }));
// >>> VSD (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/vsd", mkProxy(vsdTarget, { withRestream: true }));

// >>> Doors (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/doors", mkProxy(doorsTarget, { withRestream: true }));

// >>> Meca (Maintenance Mécanique) : re-stream nécessaire pour upload
app.use("/api/meca", mkProxy(mecaTarget, { withRestream: true }));

app.use("/api/learn-ex", mkProxy(learnExTarget, { withRestream: true }));

/* =================================================================
   Body parser APRES les proxys (pour nos routes locales uniquement)
   ================================================================= */
app.use(express.json({ limit: "25mb" }));

// -------- API de base ----------
app.get("/api/auth/me", async (req, res) => {
  const user = req.user || { id: "guest", name: "Guest", site: process.env.DEFAULT_SITE || "Nyon" };
  res.json(user);
});

// Parser local au niveau route (optionnel car express.json global est déjà monté)
app.post("/api/auth/login", express.json(), async (req, res) => {
  const { email, site = process.env.DEFAULT_SITE || "Nyon" } = req.body || {};
  const token = jwt.sign(
    { id: email || "user", name: email || "user", site },
    process.env.JWT_SECRET || "devsecret",
    { expiresIn: "7d" }  // Extended from 2h to 7 days
  );
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie("token", token, { httpOnly: true, sameSite: isProduction ? "none" : "lax", secure: isProduction });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (req, res) => {
  // Extraire l'utilisateur depuis le JWT avant de le supprimer
  try {
    const token = req.cookies?.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
      await logAuthEvent(req, 'LOGOUT', {
        email: decoded.email,
        name: decoded.name,
        user_id: decoded.id,
        company_id: decoded.company_id,
        site_id: decoded.site_id,
        role: decoded.role,
        source: decoded.source || 'unknown'
      });
    }
  } catch (e) {
    // Token invalide ou expiré - logger quand même
    await logAuthEvent(req, 'LOGOUT', { source: 'unknown', details: { reason: 'token_invalid' } });
  }
  res.clearCookie("token");
  res.json({ ok: true });
});

/* ================================================================
   🔥 Routes manquantes ajoutées pour compatibilité front actuelle
   ================================================================ */

// /api/auth/signin : Login pour utilisateurs externes (avec mot de passe)
app.post("/api/auth/signin", express.json(), async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }

  try {
    // 1️⃣ Chercher l'utilisateur dans la table users
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.is_active,
              s.name as site_name, d.name as department_name, c.name as company_name
       FROM users u
       LEFT JOIN sites s ON u.site_id = s.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      console.log(`[auth/signin] ❌ User not found: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'User not found' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    if (!user.is_active) {
      console.log(`[auth/signin] ❌ User inactive: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Account inactive' });
      return res.status(401).json({ error: "Compte désactivé" });
    }

    if (!user.password_hash) {
      console.log(`[auth/signin] ❌ No password set for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'No password set' });
      return res.status(401).json({ error: "Utilisez la connexion Bubble/SSO" });
    }

    // 2️⃣ Vérifier le mot de passe avec bcrypt
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      console.log(`[auth/signin] ❌ Invalid password for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Invalid password' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    // 3️⃣ Créer le JWT avec toutes les infos tenant
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name || 'Default',
        site_id: user.site_id,
        company_id: user.company_id,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps,
        source: 'local'
      },
      process.env.JWT_SECRET || "devsecret",
      { expiresIn: "7d" }
    );

    // 4️⃣ Mettre à jour last_login
    await pool.query(
      `UPDATE users SET last_login = NOW() WHERE id = $1`,
      [user.id]
    ).catch(e => console.log(`[auth/signin] last_login update failed: ${e.message}`));

    // 5️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, 'LOGIN', {
      email: user.email,
      name: user.name,
      user_id: user.id,
      company_id: user.company_id,
      site_id: user.site_id,
      role: user.role,
      source: 'local',
      details: { site_name: user.site_name, company_name: user.company_name }
    });
    console.log(`[auth/signin] ✅ Login successful: ${email} (company=${user.company_id}, site=${user.site_id}, role=${user.role})`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", token, { httpOnly: true, sameSite: isProduction ? "none" : "lax", secure: isProduction });

    // Retourner les infos utilisateur complètes
    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name,
        site_id: user.site_id,
        company_id: user.company_id,
        company: user.company_name,
        department: user.department_name,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps
      }
    });

  } catch (err) {
    console.error(`[auth/signin] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// /api/auth/signup : placeholder pour inscription (à brancher sur DB plus tard)
app.post("/api/auth/signup", express.json(), async (_req, res) => {
  // TODO: insérer l'utilisateur en base (pool.query(...))
  res.status(201).json({ ok: true });
});

// /api/auth/me : Rafraîchit les permissions utilisateur depuis la DB
// Permet de synchroniser les changements faits par l'admin sans déconnexion
app.get("/api/auth/me", async (req, res) => {
  try {
    // 1️⃣ Extraire l'email depuis le JWT (cookie ou header)
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    } catch (e) {
      return res.status(401).json({ error: "Token invalide" });
    }

    const email = decoded.email;
    if (!email) {
      return res.status(401).json({ error: "Email manquant dans le token" });
    }

    // 2️⃣ Récupérer les données actuelles depuis la DB
    // Chercher dans users (external users)
    let userData = null;
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.origin,
              s.name as site_name, c.name as company_name, d.name as department_name
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );
    userData = userResult.rows[0];

    // Si pas dans users, chercher dans haleon_users
    if (!userData) {
      const haleonResult = await pool.query(
        `SELECT h.id, h.email, h.name, h.department_id, h.site_id, h.allowed_apps,
                s.name as site_name, s.company_id, c.name as company_name, d.name as department_name
         FROM haleon_users h
         LEFT JOIN sites s ON s.id = h.site_id
         LEFT JOIN companies c ON c.id = s.company_id
         LEFT JOIN departments d ON d.id = h.department_id
         WHERE LOWER(h.email) = LOWER($1) LIMIT 1`,
        [email]
      );
      userData = haleonResult.rows[0];
      if (userData) {
        userData.origin = 'haleon';
        userData.role = userData.role || 'site';
      }
    }

    if (!userData) {
      // Utilisateur non trouvé en DB, retourner les infos du JWT
      return res.json({
        ok: true,
        user: {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          site: decoded.site,
          site_id: decoded.site_id,
          company_id: decoded.company_id,
          role: decoded.role || 'site',
          allowed_apps: decoded.allowed_apps,
          source: decoded.source
        },
        fromDb: false
      });
    }

    // 3️⃣ Retourner les données mises à jour depuis la DB
    console.log(`[auth/me] ✅ Refreshed permissions for ${email}: allowed_apps=${JSON.stringify(userData.allowed_apps)}`);

    res.json({
      ok: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.email.split('@')[0],
        site: userData.site_name,
        site_id: userData.site_id,
        company_id: userData.company_id,
        company: userData.company_name,
        department: userData.department_name,
        department_id: userData.department_id,
        role: userData.role || 'site',
        allowed_apps: userData.allowed_apps,
        origin: userData.origin,
        source: decoded.source || 'local'
      },
      fromDb: true
    });

  } catch (err) {
    console.error(`[auth/me] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ================================================================
   🔵 Auth via Bubble (nouvelle route)
   ================================================================ */
import { verifyBubbleToken, signLocalJWT } from "./auth-bubble.js";

app.post("/api/auth/bubble", express.json(), async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing token" });

    // 1️⃣ Vérifie le token Bubble
    const user = await verifyBubbleToken(token);
    console.log(`[auth/bubble] 📧 User: ${user.email}`);

    // 2️⃣ Cherche l'utilisateur en base pour récupérer department_id, company_id, site_id
    // On cherche dans TOUTES les tables et on fusionne les données
    let haleonUser = null;
    let mainUser = null;

    // Chercher dans haleon_users
    try {
      const haleonResult = await pool.query(
        `SELECT id, email, name, department_id, site_id, allowed_apps
         FROM haleon_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      haleonUser = haleonResult.rows[0] || null;
      console.log(`[auth/bubble] haleon_users: ${haleonUser ? JSON.stringify({ id: haleonUser.id, dept: haleonUser.department_id, site: haleonUser.site_id }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] haleon_users ERROR: ${e.message}`);
    }

    // Chercher dans users
    try {
      const result = await pool.query(
        `SELECT id, email, name, department_id, company_id, site_id, role, allowed_apps
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      mainUser = result.rows[0] || null;
      console.log(`[auth/bubble] users: ${mainUser ? JSON.stringify({ id: mainUser.id, dept: mainUser.department_id, company: mainUser.company_id, site: mainUser.site_id }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] users ERROR: ${e.message}`);
    }

    // 3️⃣ Fusionner les données - priorité à haleon_users pour le department_id
    // car c'est là que le département est mis à jour depuis le dashboard
    const isHaleon = user.email && user.email.toLowerCase().endsWith('@haleon.com');

    // Utiliser les données de haleon_users en priorité si disponibles, sinon fallback sur users
    const department_id = haleonUser?.department_id || mainUser?.department_id || null;
    const site_id = haleonUser?.site_id || mainUser?.site_id || (isHaleon ? 1 : null);
    const company_id = mainUser?.company_id || (isHaleon ? 1 : null);
    const role = mainUser?.role || 'site';
    const allowed_apps = haleonUser?.allowed_apps || mainUser?.allowed_apps || null;

    console.log(`[auth/bubble] ✅ Merged: department_id=${department_id}, company_id=${company_id}, site_id=${site_id}`);

    // 4️⃣ Crée un JWT local enrichi avec les infos de la base
    const enrichedUser = {
      ...user,
      department_id,
      company_id,
      site_id,
      role,
      allowed_apps,
    };
    const jwtToken = signLocalJWT(enrichedUser);

    // 5️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, 'LOGIN', {
      email: enrichedUser.email,
      name: enrichedUser.name,
      user_id: mainUser?.id || haleonUser?.id,
      company_id,
      site_id,
      role,
      source: 'bubble',
      details: { isHaleon, site: enrichedUser.site }
    });

    // 6️⃣ Stocke en cookie + renvoie au front
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", jwtToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });
    res.json({ ok: true, user: enrichedUser, jwt: jwtToken });
  } catch (err) {
    console.error("Bubble auth failed:", err);
    await logAuthEvent(req, 'LOGIN_FAILED', { source: 'bubble', success: false, error: err.message });
    res.status(401).json({ error: err.message || "Invalid Bubble token" });
  }
});

/* ================================================================
   🔵 Save User Profile (department, site)
   ================================================================ */
app.put("/api/user/profile", express.json(), async (req, res) => {
  console.log(`[profile] 🔵 PUT /api/user/profile called`);
  console.log(`[profile] Body:`, req.body);
  console.log(`[profile] Cookies:`, req.cookies?.token ? 'present' : 'missing');
  console.log(`[profile] Auth header:`, req.headers.authorization ? 'present' : 'missing');

  try {
    // Get user from JWT token
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log(`[profile] ❌ No token found`);
      return res.status(401).json({ error: "Not authenticated" });
    }

    const secret = process.env.JWT_SECRET || "devsecret";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      console.log(`[profile] ❌ JWT verify failed:`, jwtErr.message);
      return res.status(401).json({ error: "Invalid token: " + jwtErr.message });
    }

    const email = decoded.email;
    console.log(`[profile] 📧 Email from token: ${email}`);

    if (!email) {
      return res.status(401).json({ error: "Invalid token - no email" });
    }

    const { department_id, site_id } = req.body;
    console.log(`[profile] 📧 Updating user ${email}: department_id=${department_id}, site_id=${site_id}`);

    let dbUpdated = false;

    // Update haleon_users table (for @haleon.com users)
    if (email.toLowerCase().endsWith('@haleon.com')) {
      try {
        // Upsert into haleon_users
        await pool.query(`
          INSERT INTO haleon_users (email, department_id, site_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (email) DO UPDATE SET
            department_id = COALESCE($2, haleon_users.department_id),
            site_id = COALESCE($3, haleon_users.site_id),
            updated_at = NOW()
        `, [email.toLowerCase(), department_id, site_id || 1]);
        console.log(`[profile] ✅ Updated haleon_users for ${email}`);
        dbUpdated = true;
      } catch (haleonErr) {
        console.error(`[profile] ⚠️ haleon_users update failed:`, haleonErr.message);
        // Try alternate approach - just UPDATE if INSERT fails due to missing columns
        try {
          await pool.query(`
            UPDATE haleon_users SET
              department_id = COALESCE($2, department_id),
              site_id = COALESCE($3, site_id)
            WHERE LOWER(email) = LOWER($1)
          `, [email, department_id, site_id || 1]);
          console.log(`[profile] ✅ Updated haleon_users (UPDATE only) for ${email}`);
          dbUpdated = true;
        } catch (updateErr) {
          console.error(`[profile] ⚠️ haleon_users UPDATE also failed:`, updateErr.message);
        }
      }
    }

    // Also update users table if user exists there
    try {
      const result = await pool.query(`
        UPDATE users SET
          department_id = COALESCE($2, department_id),
          site_id = COALESCE($3, site_id),
          updated_at = NOW()
        WHERE LOWER(email) = LOWER($1)
        RETURNING id
      `, [email, department_id, site_id]);
      if (result.rowCount > 0) {
        console.log(`[profile] ✅ Updated users table for ${email}`);
        dbUpdated = true;
      }
    } catch (e) {
      console.log(`[profile] ⚠️ users table update skipped:`, e.message);
    }

    console.log(`[profile] DB updated: ${dbUpdated}`);

    // Generate a new JWT with updated info
    const newPayload = {
      ...decoded,
      department_id: department_id ?? decoded.department_id,
      site_id: site_id ?? decoded.site_id,
    };
    const newToken = jwt.sign(newPayload, secret, { expiresIn: "7d" });
    console.log(`[profile] ✅ New JWT generated with department_id=${newPayload.department_id}, site_id=${newPayload.site_id}`);

    // Set new cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", newToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });

    res.json({ ok: true, user: newPayload, jwt: newToken });
  } catch (err) {
    console.error("[profile] ❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   🔵 Public endpoints for departments and sites (for profile selection)
   Same queries as admin endpoints to ensure consistency
   ================================================================ */
app.get("/api/departments", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT d.id, d.code, d.name, d.company_id, d.site_id,
             c.name as company_name, s.name as site_name
      FROM departments d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN sites s ON d.site_id = s.id
      ORDER BY d.name ASC
    `);
    console.log(`[departments] Found ${result.rows.length} departments from DB`);
    res.json({ departments: result.rows });
  } catch (err) {
    console.error(`[departments] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ departments: [], error: err.message });
  }
});

app.get("/api/sites", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT s.id, s.code, s.name, s.company_id, s.city, s.country,
             c.name as company_name
      FROM sites s
      LEFT JOIN companies c ON s.company_id = c.id
      ORDER BY s.name ASC
    `);
    console.log(`[sites] Found ${result.rows.length} sites from DB`);
    res.json({ sites: result.rows });
  } catch (err) {
    console.error(`[sites] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ sites: [], error: err.message });
  }
});

/* ================================================================
   🔵 Admin API Routes (gestion utilisateurs, exploration DB)
   ================================================================ */
app.use("/api/admin", adminRouter);

// -------- Static ----------
const __dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
app.use(express.static(__dist));
app.get("*", (_req, res) => res.sendFile(path.join(__dist, "index.html")));

// -------- Auto-init essential tables -----------
async function addColumnIfNotExists(table, column, definition) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  } catch (err) {
    // Column might already exist or table doesn't exist
  }
}

async function initEssentialTables() {
  try {
    // Create companies table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT UNIQUE,
        logo BYTEA,
        logo_mime TEXT DEFAULT 'image/png',
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        is_internal BOOLEAN DEFAULT FALSE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[init] ✅ Table companies vérifiée');

    // Create sites table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        code TEXT,
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        timezone TEXT DEFAULT 'Europe/Zurich',
        is_active BOOLEAN DEFAULT TRUE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to sites
    await addColumnIfNotExists('sites', 'company_id', 'INTEGER');
    await addColumnIfNotExists('sites', 'code', 'TEXT');
    await addColumnIfNotExists('sites', 'address', 'TEXT');
    await addColumnIfNotExists('sites', 'city', 'TEXT');
    await addColumnIfNotExists('sites', 'country', "TEXT DEFAULT 'Switzerland'");
    await addColumnIfNotExists('sites', 'timezone', "TEXT DEFAULT 'Europe/Zurich'");
    await addColumnIfNotExists('sites', 'is_active', 'BOOLEAN DEFAULT TRUE');
    await addColumnIfNotExists('sites', 'settings', "JSONB DEFAULT '{}'::jsonb");
    console.log('[init] ✅ Table sites vérifiée + colonnes ajoutées');

    // Create departments table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        site_id INTEGER,
        code TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to departments
    await addColumnIfNotExists('departments', 'company_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'site_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'code', 'TEXT');
    await addColumnIfNotExists('departments', 'description', 'TEXT');
    await addColumnIfNotExists('departments', 'is_active', 'BOOLEAN DEFAULT TRUE');
    console.log('[init] ✅ Table departments vérifiée + colonnes ajoutées');

  } catch (err) {
    console.error('[init] ⚠️ Error creating essential tables:', err.message);
  }
}

// -------- Start -----------
const port = process.env.PORT || 3000;
initEssentialTables().then(() => {
  app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
});
