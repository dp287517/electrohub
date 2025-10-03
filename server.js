// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createProxyMiddleware } from "http-proxy-middleware";

dotenv.config();
const { Pool } = pg;

// Connexion DB (utile si tu ajoutes des routes côté app principale)
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// ---------------------------------------------
//   AUTH LIGHTWEIGHT (optionnel, comme avant)
// ---------------------------------------------
function authMiddleware(req, _res, next) {
  // Bypass public routes
  if (req.path.startsWith("/api/auth/") || req.path.startsWith("/api/public/")) return next();

  // Example: read JWT from cookie
  const token = req.cookies?.token;
  if (!token) return next(); // rendre permissif; adapter selon besoin

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    req.user = payload;
  } catch {
    // ignore / token expiré
  }
  next();
}
app.use(authMiddleware);

// ---------------------------------------------
//                API de base
// ---------------------------------------------
app.get("/api/auth/me", async (req, res) => {
  // retourne profil minimal + site
  const user = req.user || { id: "guest", name: "Guest", site: process.env.DEFAULT_SITE || "Nyon" };
  res.json(user);
});

app.post("/api/auth/login", async (req, res) => {
  const { email, site = process.env.DEFAULT_SITE || "Nyon" } = req.body || {};
  const token = jwt.sign(
    { id: email || "user", name: email || "user", site },
    process.env.JWT_SECRET || "devsecret",
    { expiresIn: "2h" }
  );
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// ---------------------------------------------
//                 PROXIES
//   (reprend la logique de ton stack)
// ---------------------------------------------
// NOTE: adapte les ports/URL si ton infra diffère.
const atexTarget          = process.env.ATEX_BASE_URL          || "http://127.0.0.1:3001";
const loopcalcTarget      = process.env.LOOPCALC_BASE_URL       || "http://127.0.0.1:3002";
const switchboardTarget   = process.env.SWITCHBOARD_BASE_URL    || "http://127.0.0.1:3003";
const selectivityTarget   = process.env.SELECTIVITY_BASE_URL    || "http://127.0.0.1:3004";
const flaTarget           = process.env.FLA_BASE_URL            || "http://127.0.0.1:3005";
const arcflashTarget      = process.env.ARCFLASH_BASE_URL       || "http://127.0.0.1:3006";
const obsolescenceTarget  = process.env.OBSOLESCENCE_BASE_URL   || "http://127.0.0.1:3007";
const hvTarget            = process.env.HV_BASE_URL             || "http://127.0.0.1:3008";
const diagramTarget       = process.env.DIAGRAM_BASE_URL        || "http://127.0.0.1:3009";
const controlsTarget      = process.env.CONTROLS_BASE_URL       || "http://127.0.0.1:3010";
const oibtTarget          = process.env.OIBT_BASE_URL           || "http://127.0.0.1:3012";
// *** NOUVEAU MODULE PROJECTS ***
const projectsTarget      = process.env.PROJECTS_BASE_URL       || "http://127.0.0.1:3013";

app.use("/api/atex",         createProxyMiddleware({ target: atexTarget,         changeOrigin: true, logLevel: "warn" }));
app.use("/api/loopcalc",     createProxyMiddleware({ target: loopcalcTarget,     changeOrigin: true, logLevel: "warn" }));
app.use("/api/switchboard",  createProxyMiddleware({ target: switchboardTarget,  changeOrigin: true, logLevel: "warn" }));
app.use("/api/selectivity",  createProxyMiddleware({ target: selectivityTarget,  changeOrigin: true, logLevel: "warn" }));
app.use("/api/faultlevel",   createProxyMiddleware({ target: flaTarget,          changeOrigin: true, logLevel: "warn" }));
app.use("/api/arcflash",     createProxyMiddleware({ target: arcflashTarget,     changeOrigin: true, logLevel: "warn" }));
app.use("/api/obsolescence", createProxyMiddleware({ target: obsolescenceTarget, changeOrigin: true, logLevel: "warn" }));
app.use("/api/hv",           createProxyMiddleware({ target: hvTarget,           changeOrigin: true, logLevel: "warn" }));
app.use("/api/diagram",      createProxyMiddleware({ target: diagramTarget,      changeOrigin: true, logLevel: "warn" }));
app.use("/api/controls",     createProxyMiddleware({ target: controlsTarget,     changeOrigin: true, logLevel: "warn" }));
app.use("/api/oibt",         createProxyMiddleware({ target: oibtTarget,         changeOrigin: true, logLevel: "warn" }));
// --- PROXY PROJECTS (NOUVEAU) ---
app.use("/api/projects",     createProxyMiddleware({ target: projectsTarget,     changeOrigin: true, logLevel: "warn" }));

// ---------------------------------------------
//            Static frontend (Vite)
// ---------------------------------------------
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

// ---------------------------------------------
//                  Start
// ---------------------------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
