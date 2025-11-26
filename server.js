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
    { expiresIn: "2h" }
  );
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

/* ================================================================
   🔥 Routes manquantes ajoutées pour compatibilité front actuelle
   ================================================================ */

// /api/auth/signin : identique à /login mais renvoie aussi { token }
app.post("/api/auth/signin", express.json(), async (req, res) => {
  const { email, site = process.env.DEFAULT_SITE || "Nyon" } = req.body || {};
  const token = jwt.sign(
    { id: email || "user", name: email || "user", site },
    process.env.JWT_SECRET || "devsecret",
    { expiresIn: "2h" }
  );
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ token });
});

// /api/auth/signup : placeholder pour inscription (à brancher sur DB plus tard)
app.post("/api/auth/signup", express.json(), async (_req, res) => {
  // TODO: insérer l'utilisateur en base (pool.query(...))
  res.status(201).json({ ok: true });
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

    // 2️⃣ Crée un JWT local pour ElectroHub (2h)
    const jwtToken = signLocalJWT(user);

    // 3️⃣ Stocke en cookie + renvoie au front
    res.cookie("token", jwtToken, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true, user, jwt: jwtToken });
  } catch (err) {
    console.error("Bubble auth failed:", err);
    res.status(401).json({ error: err.message || "Invalid Bubble token" });
  }
});

// -------- Static ----------
const __dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
app.use(express.static(__dist));
app.get("*", (_req, res) => res.sendFile(path.join(__dist, "index.html")));

// -------- Start -----------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
