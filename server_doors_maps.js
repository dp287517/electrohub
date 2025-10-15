// Node ESM
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import pg from "pg";
import StreamZip from "node-stream-zip";

// PDF.js legacy (comme ask_veeva)
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
function resolvePdfWorker(){ try { return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"); }
  catch { return require.resolve("pdfjs-dist/build/pdf.worker.mjs"); } }
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();
const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, "standard_fonts/");

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

const DATA_ROOT = path.join(process.cwd(), "uploads", "doors-maps");
const UPLOAD_DIR = path.join(DATA_ROOT, "incoming");
const STORE_DIR  = path.join(DATA_ROOT, "plans");
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(STORE_DIR,  { recursive: true });

const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req,_f,cb)=>cb(null, UPLOAD_DIR),
    filename: (_req,f,cb)=>cb(null, `${Date.now()}_${f.originalname.replace(/[^\w.\-]+/g,"_")}`)
  }),
  limits: { fileSize: 300 * 1024 * 1024 }
});

function nowISO(){
  const d=new Date(); return d.toISOString().slice(0,16).replace("T","_").replace(/:/g,"");
}
function parseName(fn=""){ // "<logical>__<version>.pdf" sinon "<logical>.pdf"
  const base = path.basename(fn).replace(/\.pdf$/i,"");
  const m = base.split("__");
  return { logical: m[0], version: m[1] || nowISO() };
}

async function pdfPageCount(abs){
  const data = new Uint8Array(await fsp.readFile(abs));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS }).promise;
  const n = doc.numPages;
  await doc.cleanup();
  return n || 1;
}

/* ------------------- UPLOAD ZIP ------------------- */
app.post("/api/doors/maps/uploadZip", uploadZip.single("zip"), async (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({ error:"zip manquant" });
    const zip = new StreamZip.async({ file: req.file.path, storeEntries:true });
    const entries = await zip.entries();
    const files = Object.values(entries).filter(e => !e.isDirectory && /\.pdf$/i.test(e.name));
    const imported = [];
    for(const entry of files){
      const tmpOut = path.join(UPLOAD_DIR, crypto.randomUUID() + ".pdf");
      await zip.extract(entry.name, tmpOut);
      const { logical, version } = parseName(entry.name);
      const safeName = `${nowISO()}_${entry.name.replace(/[^\w.\-]+/g,"_")}`;
      const dest = path.join(STORE_DIR, safeName);
      await fsp.rename(tmpOut, dest);
      const page_count = await pdfPageCount(dest).catch(()=>1);
      await pool.query(
        `INSERT INTO fd_plans (logical_name, version, filename, file_path, page_count)
         VALUES ($1,$2,$3,$4,$5)`,
        [logical, version, entry.name, dest, page_count]
      );
      // seed display_name si absent
      await pool.query(
        `INSERT INTO fd_plan_names(logical_name, display_name)
         VALUES ($1,$2) ON CONFLICT (logical_name) DO NOTHING`,
        [logical, logical]
      );
      imported.push({ logical_name: logical, version, page_count });
    }
    await zip.close();
    res.json({ ok:true, imported });
  }catch(e){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }finally{
    fs.rmSync(req.file.path, { force:true });
  }
});

/* ------------------- STREAM FICHIER ------------------- */
app.get("/api/doors/maps/plan/:id/file", async (req,res)=>{
  const { rows } = await pool.query(`SELECT * FROM fd_plans WHERE id=$1`, [req.params.id]);
  const p = rows[0];
  if(!p || !p.file_path || !fs.existsSync(p.file_path)) return res.status(404).send("not found");
  res.type("application/pdf").sendFile(path.resolve(p.file_path));
});

/* ------------------- LISTE + COMPTE ACTIONS ------------------- */
/* actions_next_30 = portes de ce logical_name avec next_check_date <= J+30 ET statut a_faire/en_cours_30
   overdue = statut en_retard */
app.get("/api/doors/maps/plans", async (_req,res)=>{
  const q = `
    WITH latest AS (
      SELECT DISTINCT ON (logical_name) id, logical_name, version, page_count, created_at
      FROM fd_plans
      ORDER BY logical_name, created_at DESC
    ),
    names AS (
      SELECT logical_name, COALESCE(display_name, logical_name) AS display_name
      FROM fd_plan_names
    ),
    counts AS (
      SELECT dp.plan_logical_name AS logical_name,
             SUM( CASE WHEN d.status='en_retard' THEN 1 ELSE 0 END ) AS overdue,
             SUM( CASE WHEN d.status IN ('a_faire','en_cours_30')
                        AND d.next_check_date IS NOT NULL
                        AND d.next_check_date <= (now()::date + INTERVAL '30 day')
                       THEN 1 ELSE 0 END ) AS actions_next_30
      FROM fd_door_positions dp
      JOIN fd_doors d ON d.id = dp.door_id
      GROUP BY dp.plan_logical_name
    )
    SELECT l.id, l.logical_name, n.display_name, l.version, l.page_count,
           COALESCE(c.actions_next_30,0)::int AS actions_next_30,
           COALESCE(c.overdue,0)::int AS overdue
    FROM latest l
    LEFT JOIN names n USING (logical_name)
    LEFT JOIN counts c ON c.logical_name = l.logical_name
    ORDER BY n.display_name ASC;
  `;
  const { rows } = await pool.query(q);
  res.json({ ok:true, plans: rows });
});

/* ------------------- RENAME (display_name) ------------------- */
app.put("/api/doors/maps/plan/:logical/rename", async (req,res)=>{
  const logical = String(req.params.logical||"");
  const { display_name } = req.body || {};
  if(!logical || !display_name) return res.status(400).json({ error:"display_name requis" });
  await pool.query(
    `INSERT INTO fd_plan_names(logical_name, display_name)
     VALUES ($1,$2)
     ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [logical, String(display_name).trim()]
  );
  res.json({ ok:true });
});

/* ------------------- POSITIONS ------------------- */
app.get("/api/doors/maps/positions", async (req,res)=>{
  const logical = String(req.query.logical_name||"");
  const page = Number(req.query.page_index||0);
  if(!logical) return res.status(400).json({ error:"logical_name requis" });
  const { rows } = await pool.query(
    `SELECT p.door_id, d.name, p.x_frac, p.y_frac, d.status
     FROM fd_door_positions p
     JOIN fd_doors d ON d.id = p.door_id
     WHERE p.plan_logical_name=$1 AND p.page_index=$2`,
    [logical, page]
  );
  res.json({ ok:true, items: rows });
});

app.put("/api/doors/maps/positions/:doorId", async (req,res)=>{
  const doorId = req.params.doorId;
  const { logical_name, page_index=0, page_label=null, x_frac, y_frac } = req.body || {};
  if(!logical_name || x_frac==null || y_frac==null) return res.status(400).json({ error:"coords/logical requis" });
  await pool.query(
    `INSERT INTO fd_door_positions (door_id, plan_logical_name, page_index, page_label, x_frac, y_frac)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING`, // pas d'unicité naturelle → on UPSERT via DELETE/INSERT simple :
    [doorId, logical_name, Number(page_index||0), page_label, Number(x_frac), Number(y_frac)]
  );
  // si existe déjà → update last row
  await pool.query(
    `UPDATE fd_door_positions
       SET x_frac=$1, y_frac=$2, updated_at=now()
     WHERE door_id=$3 AND plan_logical_name=$4 AND page_index=$5`,
    [Number(x_frac), Number(y_frac), doorId, logical_name, Number(page_index||0)]
  );
  res.json({ ok:true });
});

export default app;
