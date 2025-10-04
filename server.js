// server.js — version corrigée (proxies AVANT body-parser)
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
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Sécurité & cookies
app.use(helmet());
app.use(cookieParser());

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
// ⚠️ Correction ici : Controls écoute chez toi sur 3011
const controlsTarget     = process.env.CONTROLS_BASE_URL      || "http://127.0.0.1:3011";
const oibtTarget         = process.env.OIBT_BASE_URL          || "http://127.0.0.1:3012";
const projectsTarget     = process.env.PROJECTS_BASE_URL      || "http://127.0.0.1:3013";

// petit helper pour créer des proxys homogènes
function mkProxy(target, { withRestream = false } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: "warn",
    onError(err, req, res) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream unreachable", details: err.code || String(err) }));
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

app.use("/api/atex",         mkProxy(atexTarget));
app.use("/api/loopcalc",     mkProxy(loopcalcTarget));
app.use("/api/switchboard",  mkProxy(switchboardTarget));
app.use("/api/selectivity",  mkProxy(selectivityTarget));
app.use("/api/faultlevel",   mkProxy(flaTarget));
app.use("/api/arcflash",     mkProxy(arcflashTarget));
app.use("/api/obsolescence", mkProxy(obsolescenceTarget));
app.use("/api/hv",           mkProxy(hvTarget));
app.use("/api/diagram",      mkProxy(diagramTarget));
app.use("/api/controls",     mkProxy(controlsTarget));   // <-- corrige le 404 Controls
app.use("/api/oibt",         mkProxy(oibtTarget));

// >>> Projects : proxy bavard + re-stream (si un jour body était déjà parsé)
app.use("/api/projects", mkProxy(projectsTarget, { withRestream: true }));

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
    { expiresIn: "2h" }
  );
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// -------- Static ----------
const __dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
app.use(express.static(__dist));
app.get("*", (_req, res) => res.sendFile(path.join(__dist, "index.html")));

// -------- Start -----------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
