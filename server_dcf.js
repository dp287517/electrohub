// server_dcf.js
// VERSION FINALISÉE V3 - Assistant SAP DCF
// Nécessite: npm install express cors helmet dotenv multer pg openai xlsx

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import xlsx from "xlsx";

dotenv.config();

const app = express();
const PORT = process.env.DCF_PORT || 3030;

// --- Configuration ---
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));

// --- Chemins et Dossiers ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "dcf");
await fsp.mkdir(UPLOAD_DIR, { recursive: true });

// --- Clients ---
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // ou NEON_DATABASE_URL
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Dictionnaire SAP (Connaissance Métier) ---
// Aide l'IA à comprendre ce que signifient les codes cryptiques
const SAP_DICTIONARY = {
  "VORNR": "Numéro d'opération",
  "LTXA1": "Texte court (Description)",
  "STEUS": "Clé de contrôle (PM01/PM02)",
  "ARBEI": "Travail (Durée)",
  "ARBEH": "Unité de travail (H/MIN)",
  "ANZZL": "Nombre de personnes",
  "WERKS": "Division (Site)",
  "ARBPL": "Poste de travail",
  "EQUNR": "Équipement",
  "TPLNR": "Poste Technique",
  "PLNNR": "Groupe (Numéro Plan/Gamme)",
  "ACTION": "Action (Create/Modify)"
};

// --- Utilitaires Excel ---

// Convertit 0 -> A, 25 -> Z, 26 -> AA, etc.
function getExcelColName(n) {
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Analyse profonde du fichier DCF pour extraire la structure EXACTE
function analyzeDCFStructure(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => n.toUpperCase().includes("DCF")) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  
  // Conversion en JSON (tableau de tableaux)
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  
  if (!data || data.length === 0) return null;

  // 1. Trouver la ligne des en-têtes techniques (Codes SAP comme PLNNR, VORNR, etc.)
  // Généralement ligne 4 (index 3) ou 5 (index 4) dans les templates SAP
  let headerRowIndex = -1;
  let headers = [];
  
  // On scanne les 10 premières lignes pour trouver une ligne qui ressemble à des codes SAP
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i].map(c => String(c).trim());
    // Critère: contient au moins un mot clé SAP ou "Action"
    if (row.includes("VORNR_01") || row.includes("LTXA1") || row.includes("PLNNR") || row.includes("Action")) {
      headerRowIndex = i;
      headers = row;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Fallback: on prend la première ligne
    headerRowIndex = 0;
    headers = data[0].map(c => String(c).trim());
  }

  // 2. Mapper Colonne Excel <-> Champ SAP
  const columnMap = {}; // { "LTXA1": "AJ", "VORNR": "AG", ... }
  const structureDetails = []; // Pour le contexte IA

  headers.forEach((header, idx) => {
    if (header) {
      // Nettoyage du nom (parfois VORNR_01, parfois VORNR)
      const cleanHeader = header.split('_')[0].toUpperCase(); 
      const colLetter = getExcelColName(idx);
      
      // On stocke le map exact
      columnMap[header] = colLetter; 
      
      // On prépare l'info pour l'IA
      const description = SAP_DICTIONARY[cleanHeader] || "Champ SAP";
      structureDetails.push(`- Col ${colLetter} : ${header} (${description})`);
    }
  });

  // 3. Trouver la première ligne vide (pour insérer des données)
  let firstEmptyRow = data.length + 1;
  // On cherche la première ligne après le header qui est vide dans la colonne Action ou Opération
  // On assume que la colonne "Action" est souvent vers le début (col I ou J souvent)
  const actionColIdx = headers.findIndex(h => h.toLowerCase().includes("action"));
  
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    const isEmpty = row.every(cell => !cell || String(cell).trim() === "");
    if (isEmpty) {
      firstEmptyRow = i + 1; // +1 car Excel commence à 1
      break;
    }
  }

  return {
    sheetName,
    headerRow: headerRowIndex + 1,
    firstEmptyRow,
    columnMap,
    structureSummary: structureDetails.join("\n")
  };
}

// --- Upload Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

// --- Routes API ---

// 1. Upload & Analyse
app.post("/api/dcf/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) throw new Error("Aucun fichier reçu");

    const filePath = req.file.path;
    const analysis = analyzeDCFStructure(filePath);

    if (!analysis) throw new Error("Impossible d'analyser la structure DCF du fichier.");

    // Sauvegarde en DB
    const result = await pool.query(
      `INSERT INTO dcf_files (filename, path, analysis, uploaded_at) 
       VALUES ($1, $2, $3, NOW()) RETURNING id`,
      [req.file.originalname, filePath, analysis]
    );

    res.json({ ok: true, fileId: result.rows[0].id, analysis });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 2. Liste des fichiers
app.get("/api/dcf/files", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, filename, uploaded_at FROM dcf_files ORDER BY uploaded_at DESC");
    res.json({ ok: true, files: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 3. Chat avec le "Cerveau SAP"
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const { message, fileId, history = [] } = req.body;

    // Récupérer l'analyse du fichier
    const fileRes = await pool.query("SELECT filename, analysis FROM dcf_files WHERE id = $1", [fileId]);
    if (fileRes.rows.length === 0) throw new Error("Fichier non trouvé");
    
    const { filename, analysis } = fileRes.rows[0];

    // Construction du Prompt Système "Ultra-Précis"
    const systemPrompt = `
Tu es l'Assistant Expert DCF SAP v3. Ta mission est de donner des instructions chirurgicales pour remplir le fichier Excel.

CONTEXTE DU FICHIER ACTUEL ("${filename}"):
- Feuille de travail : ${analysis.sheetName}
- Ligne des en-têtes : Ligne ${analysis.headerRow}
- PREMIÈRE LIGNE VIDE DISPONIBLE : Ligne ${analysis.firstEmptyRow} (Utilise cette ligne pour toute création !)

STRUCTURE EXACTE DES COLONNES (Mapping):
${analysis.structureSummary}

RÈGLES ABSOLUES DE RÉPONSE :
1. Ne donne jamais de conseils vagues ("Cherchez la colonne...").
2. Donne TOUJOURS les coordonnées exactes : "Ligne X, Colonne Y".
3. Quand l'utilisateur veut créer quelque chose, utilise la ligne vide (${analysis.firstEmptyRow}).
4. Pour chaque champ à remplir, utilise ce format visuel :
   ┌─ Ligne [X], Colonne [LETTRE] ([CODE_SAP])
   │  📝 Écris: [VALEUR]
   └─
5. Si le champ est une liste déroulante ou un code (comme STEUS ou ARBEI), explique brièvement le code.

Exemple de bonne réponse :
"Pour créer l'opération de vérification :
┌─ Ligne 15, Colonne AJ (LTXA1)
│  📝 Écris: Vérification des sondes
└─"
`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Utiliser un modèle performant pour la précision
      messages: messages,
      temperature: 0.1, // Très bas pour éviter les hallucinations, on veut de la rigueur
    });

    res.json({ 
      ok: true, 
      answer: completion.choices[0].message.content 
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- Initialisation DB ---
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_files (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      analysis JSONB,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

initDB().then(() => {
  app.listen(PORT, () => console.log(`[DCF v3] Server ready on port ${PORT}`));
});
