/**
 * ElectroHub - Minimal Express server with ATEX routes
 * NOTE: This file mounts the ATEX router from server_atex.js
 */
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import atexRouter from "./server_atex.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Static (if you drop a build here)
app.use(express.static(path.join(__dirname, "dist")));

// Healthcheck
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// ATEX API
app.use("/api/atex", atexRouter);

// Fallback to SPA (optional)
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "dist", "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) res.status(200).send("ElectroHub ATEX API is running.");
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`ElectroHub server listening on :${PORT}`));
