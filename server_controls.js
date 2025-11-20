// ============================================================================
// server_controls.js — Backend TSD + Plans + IA (électrique / sécurité)
// ============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import unzipper from "unzipper";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import pg from "pg";

dayjs.extend(utc);
dotenv.config();

// --- OpenAI (IA photos / sécurité / infos équipements / match TSD/équipements)
const { OpenAI } = await import("openai");

// ============================================================================
// CONSTANTES & INIT
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.CONTROLS_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
const router = express.Router();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// ============================================================================
// IMPORT TSD LIBRARY
// ============================================================================
let tsdLibrary;
try {
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary || mod.default;
  console.log(
    `[Controls] TSD library loaded (${tsdLibrary.categories.length} categories)`
  );
} catch (e) {
  console.error("[Controls] Failed to load TSD library:", e);
  process.exit(1);
}

// Helper générique : récupère le "plan principal" d'une entité (peu importe le type)
async function getPlanForEntity(client, entityId, entityType) {
  const { rows } = await client.query(
    `
    SELECT cp.id, cp.logical_name, cp.display_name
    FROM controls_task_positions ctp
    JOIN controls_tasks ct ON ctp.task_id = ct.id
    JOIN controls_plans cp ON ctp.plan_id = cp.id
    WHERE ct.entity_id = $1
      AND ct.entity_type = $2
    ORDER BY ctp.updated_at DESC
    LIMIT 1
    `,
    [entityId, entityType]
  );

  if (!rows[0]) return null;

  const p = rows[0];
  return {
    plan_id: p.id,
    plan_logical_name: p.logical_name,
    plan_display_name: p.display_name || p.logical_name,
  };
}

// ============================================================================
// HELPERS GÉNÉRAUX
// ============================================================================

function siteOf(req) {
  return req.header("X-Site") || req.query.site || "Default";
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

function isNumericId(s) {
  return (
    (typeof s === "string" && /^\d+$/.test(s)) ||
    (typeof s === "number" && Number.isInteger(s))
  );
}

// Calcul du statut selon date d'échéance
function computeStatus(next_control) {
  if (!next_control) return "Planned";
  const now = dayjs();
  const next = dayjs(next_control);
  const diffDays = next.diff(now, "day");

  if (diffDays < 0) return "Overdue";
  if (diffDays <= 30) return "Pending";
  return "Planned";
}

// Ajout de fréquence à une date
function addFrequency(dateStr, frequency) {
  if (!frequency) return null;
  const base = dayjs(dateStr);

  if (frequency.interval && frequency.unit) {
    const unit =
      frequency.unit === "months"
        ? "month"
        : frequency.unit === "years"
        ? "year"
        : "week";
    return base.add(frequency.interval, unit).format("YYYY-MM-DD");
  }

  return null;
}

function generateInitialDate(frequency) {
  // Date de référence globale
  const refDate = dayjs("2026-01-01");
  const now = dayjs();

  // Si on est avant 2026 → on part du 01.01.2026
  // Si on est après 2026 → on part de la date du jour (ex: 20.03.2026)
  const baseDate = now.isAfter(refDate) ? now : refDate;

  return baseDate.format("YYYY-MM-DD");
}

// Trouver le contrôle TSD par task_code (dérivé de type)
function findTSDControl(taskCode) {
  if (!taskCode) return null;
  const canon = String(taskCode).toLowerCase();
  for (const cat of tsdLibrary.categories) {
    for (const c of cat.controls || []) {
      const code = c.type.toLowerCase().replace(/\s+/g, "_");
      if (code === canon) {
        return { category: cat, control: c };
      }
    }
  }
  return null;
}

// Mapping propre db_table → entity_type (pour cohérence avec l'arborescence)
function entityTypeFromCategory(cat) {
  const t = cat.db_table;
  switch (t) {
    case "hv_equipments":
      return "hvequipment";
    case "hv_devices":
      return "hvdevice";
    case "switchboards":
      return "switchboard";
    case "devices":
      return "device";
    case "sites":
      return "site";
    // VSD
    case "vsd_equipments":
      return "vsd";
    default:
      return t ? t.replace(/_/g, "") : "equipment";
  }
}

// ============================================================================
// HELPERS MÉTIER — COHÉRENCE ÉQUIPEMENT / CONTRÔLES
// ============================================================================

// Construit une chaîne "nom complet" à partir des colonnes utiles
function getEquipmentNameString(ent) {
  const parts = [];
  if (ent.name) parts.push(ent.name);
  if (ent.device_type) parts.push(ent.device_type);
  if (ent.switchboard_name) parts.push(ent.switchboard_name);
  if (ent.description) parts.push(ent.description);
  return parts.join(" ").toLowerCase();
}

// Heuristique : est-ce que cet équipement ressemble à un variateur de vitesse ?
function isVsdLikeEntity(ent) {
  const s = getEquipmentNameString(ent);
  return (
    /vsd\b/.test(s) ||
    /vfd\b/.test(s) ||
    /variateur/.test(s) ||
    /variable\s*speed/.test(s) ||
    /drive\b/.test(s) ||
    /convertisseur de fréquence/.test(s)
  );
}

// Courant assigné : on essaie de récupérer rated_current / In / rating / nominal_current
function getRatedCurrent(ent) {
  // On essaie d'abord les champs "classiques" utilisés par d'autres tables
  const candidates = [
    ent.rated_current,
    ent.in,
    ent.rating,
    ent.nominal_current,
    // Spécifique à la table devices : calibre nominal en ampères
    ent.in_amps,
    // Pour certains appareillages (MCCB / disjoncteurs avec relais Micrologic),
    // le calibre est aussi présent dans les settings (ir)
    ent.settings && ent.settings.ir,
  ].filter((v) => v != null);

  if (!candidates.length) return null;

  const raw = String(candidates[0]).replace(",", ".");
  const m = raw.match(/(\d+(\.\d+)?)/);
  if (!m) return null;

  const val = Number(m[1]);
  return Number.isFinite(val) ? val : null;
}

// Filtre générique basé sur le calibre et le libellé du contrôle
function isCurrentCompatible(ctrl, ent) {
  const label = String(ctrl.type || ctrl.description || "").toLowerCase();
  const current = getRatedCurrent(ent);
  if (!current) return true; // si on ne connaît pas le calibre, on ne filtre pas

  // Cas explicite MCCB >400A
  if (label.includes("mccb >400a")) {
    return current > 400;
  }

  // Bus duct / bus riser >800A
  if (label.includes("bus duct") || label.includes("bus riser")) {
    return current >= 800;
  }

  return true;
}

// Contrôles "globaux" de switchboard (TGBT/DB)
function isGlobalSwitchgearControl(ctrl) {
  const type = String(ctrl.type || "").toLowerCase();
  if (type.includes("visual inspection")) return true;
  if (type.includes("thermography")) return true;
  if (type.includes("busbars and cables")) return true;
  return false;
}

// Famille du device à partir de device_type / nom / référence
function getDeviceFamily(ent) {
  const devType = String(ent.device_type || "").toLowerCase();
  const name = String(ent.name || "").toLowerCase();
  const ref = String(ent.reference || "").toLowerCase();
  const ctx = `${devType} ${name} ${ref}`;

  // 1) ACB – Low Voltage Air Circuit Breakers
  if (
    ctx.includes(" acb") ||
    ctx.includes("air circuit breaker") ||
    ctx.includes("masterpact") ||
    ctx.includes("emax") ||
    ctx.includes("entelliguard")
  ) {
    return "acb";
  }

  // 2) MCCB – Molded Case Circuit Breakers
  if (
    ctx.includes("mccb") ||
    ctx.includes("compact nsx") ||
    ctx.includes(" nsx") ||
    ctx.includes("compact ns") ||
    ctx.includes(" cvs") ||
    ctx.includes(" ns ")
  ) {
    return "mccb";
  }

  // 3) MCB – Miniature / Low Voltage CB (y compris beaucoup de petits disj.)
  if (
    ctx.includes("mcb") ||
    devType.includes("low voltage circuit breaker") ||
    ctx.includes("acti9") ||
    ctx.includes("ic60") ||
    ctx.includes("idt") ||
    ctx.includes("a9f") ||
    ctx.includes("2csf") ||
    ctx.includes("rcbo") ||
    ctx.includes("rccb") ||
    ctx.includes("rccd") ||
    ctx.includes("disjoncteur différentiel") ||
    ctx.includes("disjoncteur diff") ||
    ctx.includes("interrupteur différentiel") ||
    ctx.includes("inter diff") ||
    ctx.includes("residual current circuit breaker")
  ) {
    return "mcb";
  }

  // 4) Motor Contactors
  if (
    ctx.includes("contactor") ||
    ctx.includes("contacteur") ||
    ctx.includes("lc1d") ||
    ctx.includes("lc1f") ||
    ctx.includes(" 3rt") ||
    ctx.includes(" af")
  ) {
    return "motor_contactor";
  }

  // 5) ATS – Automatic Transfer Switch
  if (
    ctx.includes(" ats") ||
    ctx.includes("automatic transfer switch") ||
    ctx.includes("inverseur de source") ||
    ctx.includes("source changeover") ||
    ctx.includes("atys")
  ) {
    return "ats";
  }

  // 6) Fused Switches / Switch-Fuse / Sectionneur-fusible
  if (
    ctx.includes("fused switch") ||
    ctx.includes("switch-fuse") ||
    ctx.includes("switch fuse") ||
    ctx.includes("fuse switch disconnector") ||
    ctx.includes("switch disconnector fuse") ||
    ctx.includes("sectionneur-fusible") ||
    ctx.includes("sectionneur fusible")
  ) {
    return "fused_switch";
  }

  // 7) Protection Relays
  if (
    ctx.includes("protection relay") ||
    ctx.includes(" relay") ||
    ctx.includes("sepam") ||
    ctx.includes("micom") ||
    ctx.includes("easergy") ||
    /\brel\d{3}\b/.test(ctx)
  ) {
    return "relay";
  }

  // 8) Fallback "safe" : si ça ressemble à un disjoncteur non classé → MCB générique
  if (
    devType.includes("circuit breaker") ||
    ctx.includes("disjoncteur") ||
    ctx.includes("breaker")
  ) {
    return "mcb";
  }

  return null;
}

// Est-ce que ce contrôle est un test RCD ?
function isRcdControl(ctrl) {
  const type = String(ctrl.type || "").toLowerCase();
  return (
    type.includes("residual current devices") ||
    type.includes("rcd / rcbo / rccb") ||
    type.includes("residual current device")
  );
}

// Est-ce que ce device est un disjoncteur / interrupteur différentiel ?
function isResidualCurrentDevice(ent) {
  const devType = String(ent.device_type || "").toLowerCase();
  const name = String(ent.name || "").toLowerCase();
  const ref = String(ent.reference || "").toLowerCase();
  const ctx = `${devType} ${name} ${ref}`;

  if (
    ctx.includes("rcbo") ||
    ctx.includes("rccb") ||
    ctx.includes("rccd") ||
    ctx.includes("residual current circuit breaker") ||
    ctx.includes("residual current device") ||
    ctx.includes("disjoncteur différentiel") ||
    ctx.includes("disjoncteur diff") ||
    ctx.includes("interrupteur différentiel") ||
    ctx.includes("inter diff")
  ) {
    return true;
  }

  if (
    ref.startsWith("a9d") ||   // ex: Schneider Acti9 RCBO
    ref.startsWith("a9n") ||   // certains inter diff / diff
    ref.startsWith("2csr")     // ABB RCD/RCBO
  ) {
    return true;
  }

  return false;
}

// Famille HV d'un équipement (site/cellule transfo) à partir du nom / code
function getHvEquipmentFamily(ent) {
  const name = String(ent.name || "");
  const code = String(ent.code || "");
  const ctx = `${name} ${code}`.toLowerCase();

  // Transfo résine / sec / dry-type
  if (
    ctx.includes("cast resin") ||
    ctx.includes("dry-type") ||
    ctx.includes("dry type") ||
    ctx.includes("résine") ||
    ctx.includes("resin") ||
    /\btrs?\b/.test(ctx) ||           // ex : TRS1 = transfo sec
    /\btr sec\b/.test(ctx)
  ) {
    return "cast_resin";
  }

  // Transfo fluide / huile / immergé
  if (
    ctx.includes("oil") ||
    ctx.includes("huile") ||
    ctx.includes("fluid") ||
    ctx.includes("immersed") ||
    ctx.includes("immergé") ||
    ctx.includes("onaf") ||
    ctx.includes("onan") ||
    /\btri?\b/.test(ctx) ||           // ex : TRI1 = transfo immergé (si tu utilises ce code)
    /\btr huile\b/.test(ctx)
  ) {
    return "fluid";
  }

  // Si rien ne matche :
  // 👉 on peut décider d'un défaut. Le plus courant dans l'industrie, c'est le transfo fluide.
  // Si tu préfères être strict et ne rien appliquer plutôt que d'assumer "fluid", remplace par `return null;`
  return "fluid";
}

function isControlForDeviceFamily(ctrl, family) {
  const type = String(ctrl.type || "").toLowerCase();

  //
  // 1) On élimine systématiquement les contrôles globaux
  //    Ces contrôles appartiennent à la section 3.2.10 (Distribution Boards)
  //    → ne doivent JAMAIS apparaître au niveau device.
  //
  if (
    type.includes("visual inspection") ||
    type.includes("thermography") ||
    type.includes("busbars and cables") ||
    type.includes("connections") || // option : si tu veux aussi les exclure
    type.includes("earth-fault loop impedance") ||
    type.includes("identification & circuit charts") ||
    type.includes("ingress protection") ||
    type.includes("fuse carriers and mcbs") ||
    type.includes("conduit and cable gland terminations") ||
    type.includes("residual current devices")
  ) {
    return false;
  }

  //
  // 2) Mapping G2.1 strict
  //    On se base uniquement sur les contrôles prévus dans 3.2.7.
  //

  // ACB (Air Circuit Breaker)
  if (family === "acb") {
    return (
      type.includes("low-voltage air circuit breakers (acb)") ||
      type.includes("low-voltage acb")
    );
  }

  // MCCB & MCB
  if (family === "mccb" || family === "mcb") {
    return type.includes("mccb");
  }

  // Contactors
  if (family === "motor_contactor") {
    return type.includes("motor contactors");
  }

  // Automatic Transfer Switch (ATS)
  if (family === "ats") {
    return type.includes("automatic transfer switch");
  }

  // Fused Switches
  if (family === "fused_switch") {
    return type.includes("fused switches");
  }

  // Protection Relays
  if (family === "relay") {
    return type.includes("protection relays");
  }

  //
  // 3) Famille inconnue → device non reconnu → aucun contrôle
  //
  return false;
}

/**
 * Filtre métier : est-ce que le contrôle de cette catégorie peut s'appliquer
 * à cet équipement ?
 */
function isControlAllowedForEntity(cat, ctrl, ent) {
  const key = cat.key || "";
  const name = getEquipmentNameString(ent);

  // ------------- HV Transformers (G2.1) -------------
  // On fait le tri entre :
  // - transformers_fluid        → transfos immergés (oil/fluid)
  // - transformers_cast_resin   → transfos secs / résine
  if (key === "transformers_fluid" || key === "transformers_cast_resin") {
    const family = getHvEquipmentFamily(ent);

    // Si on n'arrive pas à classer l'équipement HV, on peut choisir :
    // - soit renvoyer false (aucun contrôle appliqué),
    // - soit considérer `family` par défaut comme "fluid" dans getHvEquipmentFamily.
    if (!family) {
      return false;
    }

    if (key === "transformers_fluid") {
      return family === "fluid";
    }
    if (key === "transformers_cast_resin") {
      return family === "cast_resin";
    }
  }

  // Règle simple : pour la catégorie G2.1 "Distribution Boards" (3.2.10),
  // on applique TOUS les contrôles définis dans la TSD au niveau switchboard.
  if (key === "distribution_boards") {
    return true;
  }

  // Spécial G2.1 :
  // Pour les TGBT/DB (<1000 V), on utilise la catégorie "distribution_boards" (§3.2.10).
  // On NE veut PAS que le pack générique "lv_switchgear" vienne rajouter des contrôles
  // au niveau "switchboards" (sinon on duplique les tâches des disjoncteurs sur le tableau).
  if (key === "lv_switchgear" && cat.db_table === "switchboards") {
    return false;
  }


  // 0) Filtre intensité de base (MCCB >400A, Bus Duct >800A, etc.)
  if (!isCurrentCompatible(ctrl, ent)) {
    return false;
  }

  // ------------- Bus Duct / Bus Riser (>800A, <1000 Vac) -------------
  if (key === "bus_duct_riser") {
    const isBusDuct = /bus duct|bus riser|jeu de barres blindé|jeu de barres/i.test(
      name
    );
    const current = getRatedCurrent(ent);

    // Si ton site n'a pas de bus duct : tu peux même faire directement "return false"
    if (!isBusDuct) return false;

    // Cohérence avec la TSD : bus duct >800A
    if (current && current < 800) return false;

    return true;
  }

  // ------------- Distribution Boards (<1000 V ac) -------------
  if (key === "distribution_boards") {
    const isBoard =
      /tgbt|qgbt|qg\b|tableau|tab\b|db\b|distribution board|switchboard/i.test(
        name
      );
    const looksBreaker =
      /mcb|mccb|disjoncteur|breaker|interrupteur|sectionneur/i.test(name);

    // On n'accepte que si ça ressemble clairement à un tableau et pas à un simple disjoncteur
    return isBoard && !looksBreaker;
  }

  // ------------- Emergency Lighting Systems -------------
  if (key === "emergency_lighting") {
    const isEmerg =
      /baes|bloc secours|éclairage de sécurité|eclairage de securite|emergency lighting|emergency light/i.test(
        name
      );
    return isEmerg;
  }

  // ------------- UPS (Uninterruptible Power Supply) -------------
  if (key === "ups_small" || key === "ups_large") {
    const isUps = /ups\b|onduleur|uninterruptible power/i.test(name);
    return isUps;
  }

  // ------------- AC Induction Motors (LV) -------------
  if (key === "motors_lv") {
    const isMotor =
      /motor|moteur|pompe|fan|ventilateur|blower|compressor/i.test(name);
    return isMotor;
  }

  // ------------- Fire Detection and Fire Alarm Systems -------------
  if (key === "fire_detection" || key === "fire_detection_alarm") {
    const isFire =
      /ssi\b|sdsi\b|détection incendie|detection incendie|fire detection|fire alarm|smoke detector|détecteur de fumée|detecteur de fumee/i.test(
        name
      );
    return isFire;
  }

  // ------------- Power Factor Correction (>1000 V ac) -------------
  if (key === "pfc_hv" || key === "pfc_lv") {
    const isPfc =
      /pfc\b|compensation|condensateur|capacitor bank|batterie de condensateurs|power factor/i.test(
        name
      );
    return isPfc;
  }

  // ------------- Variable Speed Drives -------------
  if (key === "vsd") {
    return true;
  }

  // Par défaut : on laisse passer (IA + bon sens métier)
  return true;
}

// Mapping inverse : entity_type -> table DB (pour IA sur les tâches)
function tableFromEntityType(entityType) {
  switch (entityType) {
    case "hvequipment":
      return "hv_equipments";
    case "hvdevice":
      return "hv_devices";
    case "switchboard":
      return "switchboards";
    case "device":
      return "devices";
    case "site":
      return "sites";
    // VSD
    case "vsd":
      return "vsd_equipments";
    default:
      return null;
  }
}

// ============================================================================
// MULTER / UPLOADS
// ============================================================================

// ZIP de plans (PDF) en mémoire
const uploadZip = multer({ storage: multer.memoryStorage() });

// Dossiers data pour IA (photos, etc.)
const DATA_DIR =
  process.env.CONTROLS_DATA_DIR ||
  path.resolve(__dirname, "./_data_controls");
const FILES_DIR = path.join(DATA_DIR, "files");
for (const d of [DATA_DIR, FILES_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}

// Upload fichiers images pour IA (stockage disque)
const multerFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`
      ),
  }),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB par fichier
});

// Upload pièces jointes de contrôles (stockage en base via buffer)
const uploadFiles = multer({ storage: multer.memoryStorage() });

// ============================================================================
// IA — CLIENT OPENAI
// ============================================================================

function openaiClient() {
  const key =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_CONTROLS ||
    process.env.OPENAI_API_KEY_ATEX ||
    process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ============================================================================
// IA — ANALYSE PHOTOS / INFOS ÉQUIPEMENTS / SÉCURITÉ
// ============================================================================

/**
 * Analyse des photos d'équipements électriques / sûreté
 * Retourne un JSON structuré (nom, type, fabricant, ref, sécurité, etc.)
 */
async function controlsExtractFromFiles(client, files) {
  if (!client) throw new Error("OPENAI_API_KEY missing");
  if (!files?.length) throw new Error("no files");

  const images = await Promise.all(
    files.map(async (f) => ({
      name: f.originalname,
      mime: f.mimetype,
      data: (await fsp.readFile(f.path)).toString("base64"),
    }))
  );

  const sys = `Tu es un assistant d'inspection pour les installations électriques et de sécurité (HT, TGBT, transformateurs, UPS, éclairage de sécurité, etc.).
À partir de plusieurs photos d'équipements, tu dois extraire des informations utiles pour un outil de maintenance / contrôle (CMMS).

Renvoyer STRICTEMENT un JSON de la forme :
{
  "equipment_name": "nom lisible si visible, sinon chaîne vide",
  "equipment_type": "type ou famille (ex: HV switchgear, LV switchboard, UPS, Transformer, Motor, Lighting, etc.)",
  "manufacturer": "marque si visible",
  "reference": "référence constructeur si visible",
  "serial_number": "numéro de série éventuel",
  "location_hint": "indices de localisation visibles (bâtiment, zone, étiquette...)",
  "safety_notes": "texte court avec remarques sécurité (EPI, signalisation, étiquette danger, IP rating, etc.)",
  "keywords": ["mot-clé1", "mot-clé2", ...]
}

Contraintes :
- Si une info n'est pas visible, mets simplement une chaîne vide ou []. 
- NE RENVOIE AUCUN TEXTE EN DEHORS DU JSON.`;

  const messages = [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyse ces photos et renvoie uniquement un JSON valide.",
        },
        ...images.map((im) => ({
          type: "image_url",
          image_url: {
            url: `data:${im.mime};base64,${im.data}`,
          },
        })),
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model:
      process.env.CONTROLS_OPENAI_MODEL ||
      process.env.ATEX_OPENAI_MODEL ||
      "gpt-4o-mini",
    messages,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  let data = {};
  try {
    data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch {
    data = {};
  }

  return {
    equipment_name: String(data.equipment_name || ""),
    equipment_type: String(data.equipment_type || ""),
    manufacturer: String(data.manufacturer || ""),
    reference: String(data.reference || ""),
    serial_number: String(data.serial_number || ""),
    location_hint: String(data.location_hint || ""),
    safety_notes: String(data.safety_notes || ""),
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
  };
}

// Routes IA (photos)
router.post(
  "/ai/analyzePhotoBatch",
  multerFiles.array("files"),
  async (req, res) => {
    try {
      const client = openaiClient();
      if (!client) {
        throw new Error("OPENAI_API_KEY missing for Controls AI");
      }
      const extracted = await controlsExtractFromFiles(
        client,
        req.files || []
      );

      await Promise.all(
        (req.files || []).map((f) => fsp.unlink(f.path).catch(() => {}))
      );

      res.json({ ok: true, extracted });
    } catch (e) {
      console.error("[Controls][AI] analyzePhotoBatch error:", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Historique d'une tâche
router.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, performed_at, result_status, comments, checklist_result, observations
       FROM controls_records
       WHERE task_id = $1
       ORDER BY performed_at DESC`,
      [id]
    );
    res.json({ items: rows });
  } catch (e) {
    console.error("[Controls] tasks/:id/history error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Alias
router.post("/ai/extract", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) {
      throw new Error("OPENAI_API_KEY missing for Controls AI");
    }
    const extracted = await controlsExtractFromFiles(client, req.files || []);

    await Promise.all(
      (req.files || []).map((f) => fsp.unlink(f.path).catch(() => {}))
    );

    res.json({ ok: true, extracted });
  } catch (e) {
    console.error("[Controls][AI] extract error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// IA — ANALYSE & ASSISTANT SUR UNE TÂCHE (pour Controls.jsx / TaskDetails)
// ============================================================================

// Construit un "contexte compact" pour l'IA à partir d'une tâche
async function buildTaskContext(taskId) {
  const { rows: taskRows } = await pool.query(
    `SELECT * FROM controls_tasks WHERE id = $1`,
    [taskId]
  );
  if (!taskRows.length) return null;
  const task = taskRows[0];

  const tsd = findTSDControl(task.task_code);

  const { rows: records } = await pool.query(
    `SELECT * FROM controls_records 
     WHERE task_id = $1 
     ORDER BY performed_at DESC 
     LIMIT 10`,
    [taskId]
  );

  let equipment = null;
  const table = tableFromEntityType(task.entity_type);
  if (table) {
    try {
      const { rows: eqRows } = await pool.query(
        `SELECT * FROM ${table} WHERE id = $1`,
        [task.entity_id]
      );
      equipment = eqRows[0] || null;
    } catch (e) {
      console.warn(
        `[Controls][AI] Failed to load equipment for entity_type=${task.entity_type}, table=${table}:`,
        e.message
      );
    }
  }

  return {
    task: {
      id: task.id,
      site: task.site,
      entity_id: task.entity_id,
      entity_type: task.entity_type,
      task_name: task.task_name,
      task_code: task.task_code,
      status: task.status,
      next_control: task.next_control,
      last_control: task.last_control,
      frequency_months: task.frequency_months,
    },
    tsd: tsd
      ? {
          category_key: tsd.category.key,
          category_label: tsd.category.label,
          control_type: tsd.control.type,
          frequency: tsd.control.frequency || null,
          notes: tsd.control.notes || "",
          checklist: tsd.control.checklist || [],
          observations: tsd.control.observations || [],
        }
      : null,
    equipment,
    records: records.map((r) => ({
      id: r.id,
      performed_at: r.performed_at,
      result_status: r.result_status,
      comments: r.comments,
    })),
  };
}

// Analyse automatique d'une tâche
router.post("/tasks/:id/analyze", async (req, res) => {
  const { id } = req.params;
  try {
    const client = openaiClient();
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY missing for Controls AI",
      });
    }

    const ctx = await buildTaskContext(id);
    if (!ctx) {
      return res.status(404).json({ ok: false, error: "Task not found" });
    }

    const sys = `Tu es un expert en maintenance, inspection et essais d'installations électriques (HT, TGBT, protections, batteries, UPS, éclairage de sécurité...).
Tu aides un responsable maintenance à analyser un contrôle périodique issu d'une TSD (G2.1). 
Ton objectif : fournir un avis opérationnel exploitable immédiatement pour la sûreté / conformité du site.`;

    const user = `Contexte JSON (task_context) :
${JSON.stringify(ctx, null, 2)}

Produit une ANALYSE STRUCTURÉE en français, avec les sections numérotées :

1. Synthèse rapide (2-3 phrases maximum)
2. État du contrôle (à jour / en retard / bientôt dû) + dates clés
3. Principaux risques techniques & sécurité pour ce type d'équipement
4. Recommandations concrètes (actions à lancer, priorités)
5. Suggestions de checks supplémentaires (si pertinents)
6. Commentaires sur la fréquence actuelle (ok / à renforcer / à questionner)

Tu t'adresses à un technicien / responsable maintenance.
Pas de JSON, uniquement du texte clair et lisible.`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      temperature: 0.25,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls][AI] tasks/:id/analyze error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Assistant IA interactif sur une tâche
router.post("/tasks/:id/assistant", async (req, res) => {
  const { id } = req.params;
  const { question = "" } = req.body || {};

  try {
    const client = openaiClient();
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY missing for Controls AI",
      });
    }

    const ctx = await buildTaskContext(id);
    if (!ctx) {
      return res.status(404).json({ ok: false, error: "Task not found" });
    }

    const sys = `Tu es un assistant IA spécialisé en maintenance électrique industrielle, conformité TSD et sûreté (HT, TGBT, protections, EPI, etc.).
Tu réponds de manière précise, actionnable et orientée terrain.`;

    const user = `Voici le contexte de la tâche (JSON compact) :
${JSON.stringify(ctx, null, 2)}

Question de l'utilisateur :
"${question}"

Consignes :
- Réponds en français.
- Donne une réponse structurée, opérationnelle (utilisable directement sur le terrain ou pour un plan d'actions).
- Si une information manque dans le contexte, dis-le simplement et propose des hypothèses réalistes.`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      temperature: 0.35,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls][AI] tasks/:id/assistant error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// ROUTE: GET /hierarchy/tree
// ============================================================================

router.get("/hierarchy/tree", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const statusFilter = String(req.query.status || "open").toLowerCase();

    const filterTasks = (tasks) => {
      if (!Array.isArray(tasks)) return [];
      return tasks
        .map((t) => ({
          ...t,
          status: computeStatus(t.next_control),
        }))
        .filter((t) => {
          if (statusFilter === "all") return true;
          if (statusFilter === "done") {
            return !!t.last_control;
          }
          return ["Planned", "Pending", "Overdue"].includes(t.status);
        });
    };

    const buildings = [];

    const { rows: buildingRows } = await client.query(
      `
      SELECT DISTINCT building_code AS code FROM (
        SELECT building_code FROM switchboards WHERE building_code IS NOT NULL AND site = $1
        UNION
        SELECT building_code FROM hv_equipments WHERE building_code IS NOT NULL AND site = $1
      ) q
      ORDER BY building_code
    `,
      [site]
    );

    for (const bRow of buildingRows) {
      const building = { label: bRow.code, hv: [], switchboards: [], vsds: [] };

      // ---------- HV ----------
      const { rows: hvEquips } = await client.query(
        `SELECT * FROM hv_equipments WHERE building_code = $1 AND site = $2`,
        [bRow.code, site]
      );

      for (const hv of hvEquips) {
        // Est-ce qu'au moins une tâche de cet équipement a une position ?
        const { rows: hvPosCheck } = await client.query(
          `SELECT EXISTS(
            SELECT 1 FROM controls_task_positions ctp
            JOIN controls_tasks ct ON ctp.task_id = ct.id
            WHERE ct.entity_id = $1 
              AND ct.entity_type = 'hvequipment'
          ) as positioned`,
          [hv.id]
        );
        const hvPositioned = hvPosCheck[0]?.positioned || false;

        // 🔹 Si positionné, on récupère le plan générique
        const hvPlan = hvPositioned
          ? await getPlanForEntity(client, hv.id, "hvequipment")
          : null;

        // Tâches HV
        const { rows: hvTasksRaw } = await client.query(
          `SELECT ct.*,
            EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              WHERE ctp.task_id = ct.id
            ) as positioned
          FROM controls_tasks ct
          WHERE ct.entity_id = $1 
            AND ct.entity_type = 'hvequipment'`,
          [hv.id]
        );
        const hvTasks = filterTasks(hvTasksRaw);

        // Appareils HT rattachés
        const { rows: hvDevices } = await client.query(
          `SELECT * FROM hv_devices WHERE hv_equipment_id = $1 AND site = $2`,
          [hv.id, site]
        );

        const devices = [];

        for (const d of hvDevices) {
          // Est-ce que l'appareil HT a une position propre ?
          const { rows: dvPosCheck } = await client.query(
            `SELECT EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              JOIN controls_tasks ct ON ctp.task_id = ct.id
              WHERE ct.entity_id = $1
                AND ct.entity_type = 'hvdevice'
            ) as positioned`,
            [d.id]
          );

          const devicePositioned =
            (dvPosCheck[0]?.positioned || false) || hvPositioned;

          // Tâches de l'appareil HT
          const { rows: devTasksRaw } = await client.query(
            `SELECT ct.*,
              EXISTS(
                SELECT 1 FROM controls_task_positions ctp
                WHERE ctp.task_id = ct.id
              ) as positioned
            FROM controls_tasks ct
            WHERE ct.entity_id = $1 
              AND ct.entity_type = 'hvdevice'`,
            [d.id]
          );
          const devTasks = filterTasks(devTasksRaw);

          // 🔹 Plan de l'appareil HT : son propre plan, sinon on hérite du plan HV
          const dvPlanRaw = await getPlanForEntity(client, d.id, "hvdevice");
          const dvPlan = dvPlanRaw || hvPlan || null;

          devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: devicePositioned,
            entity_type: "hvdevice",
            tasks: devTasks,
            ...(dvPlan || {}), // plan_id, plan_logical_name, plan_display_name
          });
        }

        // Objet HV dans l'arborescence
        building.hv.push({
          id: hv.id,
          label: hv.name,
          positioned: hvPositioned,
          entity_type: "hvequipment",
          building_code: bRow.code,
          tasks: hvTasks,
          devices,
          ...(hvPlan || {}), // plan_id, plan_logical_name, plan_display_name
        });
      }

      // ---------- SWITCHBOARDS ----------
      const { rows: swRows } = await client.query(
        `SELECT * FROM switchboards WHERE building_code = $1 AND site = $2`,
        [bRow.code, site]
      );

      for (const sw of swRows) {
        // Est-ce qu'au moins une tâche du TGBT a une position ?
        const { rows: swPosCheck } = await client.query(
          `SELECT EXISTS(
            SELECT 1 FROM controls_task_positions ctp
            JOIN controls_tasks ct ON ctp.task_id = ct.id
            WHERE ct.entity_id = $1
              AND ct.entity_type = 'switchboard'
          ) as positioned`,
          [sw.id]
        );
        const swPositioned = swPosCheck[0]?.positioned || false;

        // 🔹 Plan du TGBT si positionné
        const swPlan = swPositioned
          ? await getPlanForEntity(client, sw.id, "switchboard")
          : null;

        // Tâches TGBT
        const { rows: swTasksRaw } = await client.query(
          `SELECT ct.*,
            EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              WHERE ctp.task_id = ct.id
            ) as positioned
          FROM controls_tasks ct
          WHERE ct.entity_id = $1 
            AND ct.entity_type = 'switchboard'`,
          [sw.id]
        );
        const swTasks = filterTasks(swTasksRaw);

        const swObj = {
          id: sw.id,
          label: sw.name,
          positioned: swPositioned,
          entity_type: "switchboard",
          building_code: bRow.code,
          tasks: swTasks,
          devices: [],
          ...(swPlan || {}), // plan_id, plan_logical_name, plan_display_name
        };

        // Appareils BT rattachés
        const { rows: devRows } = await client.query(
          `SELECT * FROM devices WHERE switchboard_id = $1 AND site = $2`,
          [sw.id, site]
        );

        for (const d of devRows) {
          // Est-ce que l'appareil BT a une position propre ?
          const { rows: devPosCheck } = await client.query(
            `SELECT EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              JOIN controls_tasks ct ON ctp.task_id = ct.id
              WHERE ct.entity_id = $1
                AND ct.entity_type = 'device'
            ) as positioned`,
            [d.id]
          );
          const devicePositioned =
            (devPosCheck[0]?.positioned || false) || swPositioned;

          // Tâches de l'appareil BT
          const { rows: devTasksRaw } = await client.query(
            `SELECT ct.*,
              EXISTS(
                SELECT 1 FROM controls_task_positions ctp
                WHERE ctp.task_id = ct.id
              ) as positioned
            FROM controls_tasks ct
            WHERE ct.entity_id = $1 
              AND ct.entity_type = 'device'`,
            [d.id]
          );
          const devTasks = filterTasks(devTasksRaw);

          // 🔹 Plan de l'appareil BT : son propre plan, sinon on hérite du plan TGBT
          const devPlanRaw = await getPlanForEntity(client, d.id, "device");
          const devPlan = devPlanRaw || swPlan || null;

          swObj.devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: devicePositioned,
            entity_type: "device",
            tasks: devTasks,
            ...(devPlan || {}), // plan_id, plan_logical_name, plan_display_name
          });
        }

        if (swObj.tasks.length || swObj.devices.length) {
          building.switchboards.push(swObj);
        }
      }

      // ---------- VSD ----------
      let vsdRows = [];
      try {
        const { rows } = await client.query(
          `SELECT * FROM vsd_equipments WHERE building = $1`,
          [bRow.code]
        );
        vsdRows = rows || [];
      } catch (e) {
        console.error(
          "[Controls] hierarchy/tree VSD query error:",
          e.message || e
        );
        vsdRows = [];
      }

      for (const v of vsdRows) {
        // Est-ce que le VSD a au moins une tâche positionnée ?
        const { rows: vsdPosCheck } = await client.query(
          `SELECT EXISTS(
            SELECT 1 FROM controls_task_positions ctp
            JOIN controls_tasks ct ON ctp.task_id = ct.id
            WHERE ct.entity_id = $1 
              AND ct.entity_type = 'vsd'
          ) as positioned`,
          [v.id]
        );
        const vsdPositioned = vsdPosCheck[0]?.positioned || false;

        const vsdPlan = vsdPositioned
          ? await getPlanForEntity(client, v.id, "vsd")
          : null;

        // Tâches VSD
        const { rows: vsdTasksRaw } = await client.query(
          `SELECT ct.*,
            EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              WHERE ctp.task_id = ct.id
            ) as positioned
          FROM controls_tasks ct
          WHERE ct.entity_id = $1 
            AND ct.entity_type = 'vsd'`,
          [v.id]
        );
        const vsdTasks = filterTasks(vsdTasksRaw);

        // ON A SUPPRIMÉ LE IF (vsdTasks.length > 0) ICI
        // On ajoute l'équipement dans tous les cas
        building.vsds.push({
          id: v.id,
          label: v.name || v.equipment || `VSD ${v.id}`,
          positioned: vsdPositioned,
          entity_type: "vsd",
          building_code: bRow.code,
          tasks: vsdTasks,
          ...(vsdPlan || {}),
        });
      }

      // ---------- Filtre final bâtiment ----------
      if (
        building.hv.length > 0 ||
        building.switchboards.length > 0 ||
        building.vsds.length > 0
      ) {
        buildings.push(building);
      }
    } // Fin de la boucle for (const bRow of buildingRows)

    res.json({ buildings });

  } catch (e) {
    console.error("[Controls] hierarchy/tree error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /tasks/:id/schema
// ============================================================================

router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task = rows[0];
    const tsd = findTSDControl(task.task_code);

    if (!tsd) {
      return res.json({
        checklist: [],
        observations: [],
        notes: "Aucun schéma TSD trouvé",
      });
    }

    const { category, control } = tsd;

    const schema = {
      category_key: category.key,
      tsd_code: task.task_code,
      checklist: (control.checklist || []).map((q, i) => ({
        key: `${category.key}_${i}`,
        label: typeof q === "string" ? q : q.label || q,
      })),
      observations: (control.observations || []).map((o, i) => ({
        key: `${category.key}_obs_${i}`,
        label: typeof o === "string" ? o : o.label || o,
      })),
      notes: control.notes || control.description || "",
      frequency: control.frequency,
    };

    res.json(schema);
  } catch (e) {
    console.error("[Controls] tasks/:id/schema error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ROUTE: PATCH /tasks/:id/close
// ============================================================================

router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;

  const body = req.body || {};
  const checklist = body.checklist || body.items || [];
  const observations = body.observations || body.obs || {};
  const comment = body.comment ?? body.comments ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Task not found" });
    }

    const task = rows[0];
    const tsd = findTSDControl(task.task_code);
    const frequency = tsd?.control?.frequency;

    const now = dayjs().format("YYYY-MM-DD");
    const nextControl = frequency ? addFrequency(now, frequency) : null;

    await client.query(
      `INSERT INTO controls_records (
        task_id,
        performed_at,
        checklist_result,
        comments,
        result_status,
        site,
        observations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        now,
        JSON.stringify(checklist || []),
        comment || null,
        "Done",
        task.site,
        JSON.stringify(observations || {}),
      ]
    );

    await client.query(
      `UPDATE controls_tasks
       SET last_control = $1,
           next_control = $2,
           status = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [now, nextControl, "Planned", id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      next_control: nextControl,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Controls] close task error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTES FICHIERS CONTROLS (pièces jointes / photos)
// ============================================================================

// POST /files/upload
router.post("/files/upload", uploadFiles.array("files"), async (req, res) => {
  const { task_id, entity_id, entity_type } = req.body;
  const site = siteOf(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const f of req.files || []) {
      await client.query(
        `INSERT INTO controls_files
         (site, task_id, entity_id, entity_type, filename, mime_type, content, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          site,
          task_id || null,
          entity_id || null,
          entity_type || null,
          f.originalname,
          f.mimetype,
          f.buffer,
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Controls] files/upload error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /files
router.get("/files", async (req, res) => {
  const site = siteOf(req);
  const { entity_id, entity_type } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, mime_type, created_at
       FROM controls_files
       WHERE site = $1
         AND ($2::text IS NULL OR entity_id = $2::text) -- On traite l'ID comme du texte
         AND ($3::text IS NULL OR entity_type = $3::text)
       ORDER BY created_at DESC`,
      [site, entity_id || null, entity_type || null]
    );

    const base =
      process.env.CONTROLS_BASE_PATH || "/api/controls";

    const items = rows.map((r) => ({
      ...r,
      url: `${base}/files/${r.id}`,
    }));
    res.json({ items });
  } catch (e) {
    console.error("[Controls] files list error:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /files/:id
router.get("/files/:id", async (req, res) => {
  const { id } = req.params;
  const site = siteOf(req);
  try {
    const { rows } = await pool.query(
      `SELECT filename, mime_type, content
       FROM controls_files
       WHERE id = $1 AND site = $2`,
      [id, site]
    );
    if (!rows.length) {
      return res.status(404).send("Not found");
    }
    const f = rows[0];
    res.setHeader("Content-Type", f.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${f.filename}"`
    );
    res.send(f.content);
  } catch (e) {
    console.error("[Controls] file download error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// IA — AUTO-LINK : MATCH INTELLIGENT TSD <-> ÉQUIPEMENTS
// ============================================================================

/**
 * IA : pour une catégorie TSD donnée, suggère quels contrôles appliquer à quels équipements.
 * - category : un objet de tsdLibrary.categories[i]
 * - entities : rows de la table DB (id, name, device_type, switchboard_name, ...)
//  Retour attendu (JSON IA) :
//  { "items": [ { "equipment_id": 12, "controls": ["Visual Inspection", "Low-Voltage ACB – Annual"] }, ... ] }
 */
async function aiSuggestControlsForCategory(client, category, entities) {
  if (!client || !entities.length) return null;

  const controlsSummary = (category.controls || []).map((c) => ({
    type: c.type,
    description: c.description || "",
    frequency: c.frequency || null,
  }));

  const equipmentsSummary = entities.map((e) => ({
    id: e.id,
    name:
      e.name ||
      e.device_type ||
      e.switchboard_name ||
      e.label ||
      `${category.db_table} #${e.id}`,
    device_type: e.device_type || null,
    switchboard_type: e.switchboard_type || null,
    rated_current:
      e.rated_current ||
      e.in ||
      e.rating ||
      e.nominal_current ||
      null,
    tags: e.tags || null,
    building_code: e.building_code || e.building || null,
  }));

  const sys = `Tu es un assistant IA de maintenance électrique industrielle.
Tu aides à appliquer une TSD (Testing & Inspection) à un parc d'équipements.

On te donne :
- une catégorie TSD (par ex. "Low voltage switchgear (<1000 V ac)") avec sa liste de contrôles standard,
- une liste d'équipements (tableaux, cellules HT, devices, etc.) extraits d'une base de données.

Objectif :
- Pour CHAQUE équipement, décider quels contrôles de la TSD sont pertinents.
- Certains équipements peuvent n'avoir qu'un sous-ensemble des contrôles (par ex. tous n'ont pas de protections à injection primaire, etc.).
- Si tu n'as pas assez d'information pour distinguer, applique les contrôles "généraux" (inspection visuelle, tests de base) mais évite les contrôles manifestement hors sujet.

Contraintes importantes :
- Les noms de contrôles dans ta réponse DOIVENT correspondre EXACTEMENT aux champs "type" des contrôles TSD fournis.
- Ne crée PAS de contrôles inventés.
- Ne renvoie aucun texte hors JSON.`;

  const user = `Catégorie TSD (JSON) :
\`\`\`json
${JSON.stringify(
  {
    key: category.key,
    label: category.label,
    controls: controlsSummary,
  },
  null,
  2
)}
\`\`\`

Équipements (JSON) :
\`\`\`json
${JSON.stringify(equipmentsSummary, null, 2)}
\`\`\`

Réponds STRICTEMENT avec un JSON de la forme :

{
  "items": [
    {
      "equipment_id": <id de l'équipement>,
      "controls": ["Nom exact du contrôle 1", "Nom exact du contrôle 2", ...]
    },
    ...
  ]
}`;

  const resp = await client.chat.completions.create({
    model:
      process.env.CONTROLS_OPENAI_MODEL ||
      process.env.ATEX_OPENAI_MODEL ||
      "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  let parsed = null;
  try {
    parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch {
    parsed = null;
  }

  if (!parsed || !Array.isArray(parsed.items)) return null;
  return parsed.items;
}

// ============================================================================
// ROUTE: GET /bootstrap/auto-link
// Bootstrap / resync TSD → controls_tasks pour un site
// - NE SUPPRIME PLUS les tâches existantes
// - Utilise l'IA (si dispo) pour choisir les contrôles par équipement
// ============================================================================

router.get("/bootstrap/auto-link", async (req, res) => {
  const site = siteOf(req);
  const client = await pool.connect();

  // On peut désactiver l'IA avec ?ai=0 dans l'URL
  const aiRequested = String(req.query.ai ?? "1") === "1";
  const aiClient = aiRequested ? openaiClient() : null;
  const useAI = !!aiClient;

  try {
    await client.query("BEGIN");

    let created = 0;
    let usedAI = false;
    const warnings = [];

    // Parcours de toutes les catégories de la TSD
    for (const cat of tsdLibrary.categories || []) {
      const tableName = cat.db_table;
      if (!tableName) continue;

      const controls = cat.controls || [];
      if (!controls.length) continue;

      // Pour certains types (ex: VSD), on veut détecter les équipements "suspects" sans contrôle
      const vsdLikeMissing = [];

      // Certaines catégories doivent TOUJOURS appliquer leurs contrôles
      // sans passer par l'IA (ex: tableaux TGBT/DB, distribution boards)
      const forceFullControls =
        cat.key === "lv_switchgear" ||
        cat.key === "lv_switchgear_devices" ||
        cat.key === "distribution_boards"
        cat.key === "vsd";

      // ------------------------------
      // 1) Vérifier que la table existe + récupérer les équipements
      // ------------------------------
      let entities = [];

      // 1.a) Vérifier si la table existe réellement
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables 
           WHERE table_name = $1
         )`,
        [tableName]
      );
      const hasTable = tableCheck[0]?.exists;

      if (!hasTable) {
        console.warn(
          `[Controls][auto-link] Table absente, catégorie ignorée: ${tableName}`
        );
        continue; // on passe à la catégorie suivante sans casser la transaction
      }

      // 1.b) Vérifier si la colonne "site" existe dans la table
      const { rows: colCheck } = await client.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.columns 
           WHERE table_name = $1 AND column_name = 'site'
         )`,
        [tableName]
      );
      const hasSiteCol = colCheck[0]?.exists;

      // 1.c) Récupérer les entités (filtrées par site si possible)
      const { rows } = await client.query(
        hasSiteCol
          ? `SELECT * FROM ${tableName} WHERE site = $1`
          : `SELECT * FROM ${tableName}`,
        hasSiteCol ? [site] : []
      );

      entities = rows;
      if (!entities.length) continue;

      const entityType = entityTypeFromCategory(cat);

      // ------------------------------
      // 2) Index des contrôles TSD par "type_key" (snake_case)
      // ------------------------------
      const controlsByKey = {};
      const controlsCatalogForAI = controls.map((c) => {
        const typeKey = c.type
          ? c.type.toLowerCase().replace(/\s+/g, "_")
          : null;
        if (typeKey) {
          controlsByKey[typeKey] = c;
        }
        return {
          type: c.type,
          type_key: typeKey,
          description: c.description || c.notes || "",
          frequency: c.frequency || null,
        };
      });

      // ------------------------------
      // 3) Appel IA (optionnel) pour décider les contrôles par équipement
      // ------------------------------
      let decisionsByEquipment = [];
      if (useAI) {
        try {
          usedAI = true;

          const aiPayload = {
            site,
            db_table: tableName,
            category: {
              key: cat.key,
              label: cat.label,
            },
            controls_catalog: controlsCatalogForAI,
            equipments: entities.map((e) => ({
              id: e.id,
              raw: e, // on donne tout, l'IA se débrouille
            })),
          };

          const sys = `
    Tu es un ingénieur électricien / ingénieur maintenance industriel.
    Tu connais très bien :
    - les installations HT/MT/BT,
    - les TGBT, tableaux de distribution, MCC, UPS, batteries, éclairage de sécurité,
    - les zones ATEX / Hazardous Areas (IEC 60079).

    Ton rôle :
    À partir d'une liste d'équipements (issue d'une base de données) et d'un catalogue de contrôles (TSD),
    tu dois décider quels contrôles appliquer à CHAQUE équipement.

    RÈGLES IMPORTANTES (TRÈS STRICTES) :
    - Tu parles "comme un électricien", tu comprends les abréviations :
      TR1, TR2, TX, TGBT, DB, MCC, UPS, LV, HV, MV, Ex, Zone 1, Zone 2, etc.
    - Tu comprends les tensions implicites :
      - switchboards / distribution boards / TGBT < 1000 V ac
      - high voltage / HV / transformateurs / cellules > 1000 V ac
    - Tu es TRÈS CONSERVATEUR :
      - si tu n'es pas sûr qu'un contrôle s'applique à un équipement, tu NE L'AJOUTES PAS.
      - Tu préfères renvoyer une liste vide plutôt que mettre un contrôle incorrect.

    Exemples de cohérence :
    - Les contrôles "Cast Resin Transformers" ne s'appliquent qu'à des transformateurs résine HT.
    - Les contrôles "Hazardous Areas (IEC 60079)" ne s'appliquent qu'à des équipements clairement en zone Ex / ATEX.
    - Les contrôles "Emergency Lighting Systems" s'appliquent seulement si l'équipement est lié à l'éclairage de sécurité (BAES, blocs secours, etc.).
    - Les contrôles "Battery Systems" s'appliquent à des systèmes de batteries (UPS, chargeurs, baies batteries...).
    - Les contrôles "Fire Detection and Fire Alarm Systems" s'appliquent aux systèmes de détection incendie (SSI, détecteurs, centrales incendie), pas aux TGBT ou devices de puissance.
    - Les contrôles "Distribution Boards (<1000 V ac)" s'appliquent uniquement aux tableaux de distribution (TGBT, DB, QGBT, QG, MCC, etc.), pas à un disjoncteur individuel.
    - Les contrôles "Power Factor Correction (>1000 V ac)" s'appliquent uniquement aux équipements de type batterie de condensateurs / compensation de réactif (PFC, capacitor bank...), jamais aux autres cellules HT.
    - Les contrôles "Variable Speed Drives" s'appliquent uniquement aux variateurs de vitesse (VSD, variateur, VFD, drive de moteur).

    Si aucune correspondance évidente :
    - Tu renvoies une liste vide de contrôles pour cet équipement.

    Tu NE DOIS PAS inventer de nouveaux types de contrôles.
    Tu NE DOIS utiliser que les contrôles présents dans controls_catalog (en utilisant leur "type_key").

    Réponse STRICTEMENT en JSON, sans texte autour, au format :
    {
      "decisions_by_equipment": [
        {
          "equipment_id": <id numérique>,
          "controls": ["type_key1", "type_key2", ...]
        },
        ...
      ]
    }
          `.trim();

          const user = `
Contexte JSON :

\`\`\`json
${JSON.stringify(aiPayload, null, 2)}
\`\`\`

Consignes :
- Pour chaque equipment_id, choisis UNIQUEMENT les contrôles dont le "type_key" correspond clairement.
- Tu n'es PAS obligé de proposer des contrôles pour tous les équipements.
- Si aucun contrôle n'est pertinent pour un équipement : retourne "controls": [] pour lui, ou ne le mets pas dans la liste.
          `.trim();

          const resp = await aiClient.chat.completions.create({
            model:
              process.env.CONTROLS_OPENAI_MODEL ||
              process.env.ATEX_OPENAI_MODEL ||
              "gpt-4o-mini",
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user },
            ],
          });

          let parsed = {};
          try {
            parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
          } catch {
            parsed = {};
          }

          if (
            parsed &&
            Array.isArray(parsed.decisions_by_equipment)
          ) {
            decisionsByEquipment = parsed.decisions_by_equipment;
          } else {
            decisionsByEquipment = [];
          }
        } catch (e) {
          console.error(
            "[Controls][auto-link][AI] error on category:",
            cat.label,
            e
          );
          decisionsByEquipment = [];
        }
      }

      // ------------------------------
      // 4) Index IA : equipment_id → liste de type_key valides
      // ------------------------------
      const aiMap = new Map();
      if (Array.isArray(decisionsByEquipment)) {
        for (const item of decisionsByEquipment) {
          if (!item || !item.equipment_id) continue;
          const list = Array.isArray(item.controls) ? item.controls : [];
          aiMap.set(
            item.equipment_id,
            list.filter(
              (t) => typeof t === "string" && controlsByKey[t]
            )
          );
        }
      }

      // ------------------------------
      // 5) Création des tâches par équipement
      // ------------------------------
      // ⚠️ On passe en boucle indexée pour pouvoir lisser les VSD (5/jour)
      for (let i = 0; i < entities.length; i++) {
        const ent = entities[i];

        const label =
          ent.name ||
          ent.device_type ||
          ent.switchboard_name ||
          `${tableName} #${ent.id}`;

        let controlsForThis = [];

        // ----------------------------
        // Cas particulier : devices BT (lv_switchgear_devices)
        // ----------------------------
        if (cat.key === "lv_switchgear_devices") {
          const family = getDeviceFamily(ent);
          const isRcd = isResidualCurrentDevice(ent);

          //
          // 5.1) On essaie d'abord avec nos règles maison (famille + RCD)
          //
          const ruleBased = controls.filter((ctrl) => {
            if (!ctrl) return false;

            // Contrôles RCD : uniquement sur des différentiels
            if (isRcdControl(ctrl)) {
              return isRcd;
            }

            // Autres contrôles LV (ACB, MCCB, contactors, ATS, etc.)
            if (!family) return false;
            return isControlForDeviceFamily(ctrl, family);
          });

          if (ruleBased.length > 0) {
            controlsForThis = ruleBased;
          } else if (useAI && aiMap.has(ent.id) && aiMap.get(ent.id).length) {
            //
            // 5.2) Fallback IA : si nos règles ne savent pas quoi faire,
            // on laisse OpenAI proposer les contrôles, puis on refiltre plus bas.
            //
            controlsForThis = aiMap
              .get(ent.id)
              .map((key) => controlsByKey[key])
              .filter(Boolean);
          } else {
            controlsForThis = [];
          }
        } else {
          // ----------------------------
          // Cas général pour toutes les autres catégories
          // ----------------------------
          if (forceFullControls) {
            // Catégories pour lesquelles on applique toujours tout le catalogue TSD
            controlsForThis = controls;
          } else if (useAI) {
            // IA active : on n'applique que ce que l'IA a explicitement validé
            if (aiMap.has(ent.id) && aiMap.get(ent.id).length) {
              controlsForThis = aiMap
                .get(ent.id)
                .map((key) => controlsByKey[key])
                .filter(Boolean);
            } else {
              controlsForThis = [];
            }
          } else {
            // IA désactivée : on applique toute la catégorie
            controlsForThis = controls;
          }
        }

        // ----------------------------
        // 5.z) Post-traitement par catégorie
        // ----------------------------

        // LV SWITCHGEAR (TGBT/DB) : on garde UNIQUEMENT les contrôles globaux
        if (cat.key === "lv_switchgear") {
          controlsForThis = controlsForThis.filter((ctrl) =>
            isGlobalSwitchgearControl(ctrl)
          );
        }

        // LV DEVICES : filtre final par famille + RCD,
        // valable aussi bien pour le mode "règles" que pour le fallback IA.
        if (cat.key === "lv_switchgear_devices") {
          const family = getDeviceFamily(ent);
          const isRcd = isResidualCurrentDevice(ent);

          controlsForThis = controlsForThis.filter((ctrl) => {
            if (!ctrl) return false;

            // RCD → uniquement si device identifié comme différentiel
            if (isRcdControl(ctrl)) {
              return isRcd;
            }

            // Autres contrôles : uniquement si famille connue
            if (!family) return false;
            return isControlForDeviceFamily(ctrl, family);
          });
        }

        // 5.a) Filtre métier backend global (intensité, catégorie, etc.)
        controlsForThis = controlsForThis.filter((ctrl) =>
          isControlAllowedForEntity(cat, ctrl, ent)
        );

        // 5.b) Cas particulier VSD : warning si équipement "VSD-like" sans contrôle
        if (cat.key === "vsd" && isVsdLikeEntity(ent) && controlsForThis.length === 0) {
          vsdLikeMissing.push({
            id: ent.id,
            label,
          });
        }

        // ------------------------------------------------
        // 5.c) Création des tâches avec lissage pour VSD
        // ------------------------------------------------

        // Pour les VSD, on applique la règle : 5 équipements max par jour.
        // On décale la date de départ de (index / 5) jours.
        let baseDateForEntity = null;
        if (cat.key === "vsd") {
          const VSD_PER_DAY = 5;
          const dayOffset = Math.floor(i / VSD_PER_DAY);

          // Ancre : lundi prochain
          const startAnchor = dayjs().add(1, "week").startOf("week");
          baseDateForEntity = startAnchor.add(dayOffset, "day");
        }

        for (const ctrl of controlsForThis) {
          if (!ctrl) continue;

          const taskCode = ctrl.type.toLowerCase().replace(/\s+/g, "_");

          // Si VSD, on utilise notre date calculée, sinon la méthode standard
          let firstDate;
          if (cat.key === "vsd" && baseDateForEntity) {
            firstDate = baseDateForEntity.format("YYYY-MM-DD");
          } else {
            firstDate = generateInitialDate(ctrl.frequency || null);
          }

          // Prochaine échéance (si frequency existe)
          const nextDate = addFrequency(firstDate, ctrl.frequency || null);

          // Fréquence en mois (pour info / stats)
          let freqMonths = null;
          if (ctrl.frequency?.interval && ctrl.frequency?.unit) {
            const { interval, unit } = ctrl.frequency;
            if (unit === "months") freqMonths = interval;
            else if (unit === "years") freqMonths = interval * 12;
            else if (unit === "weeks") {
              freqMonths = Math.round((interval * 7) / 30);
            }
          }

          // INSERTION (ON CONFLICT DO NOTHING préserve les dates existantes)
          // La logique de lissage ne s'appliquera donc QUE sur les nouvelles tâches
          const result = await client.query(
            `INSERT INTO controls_tasks
               (site, entity_id, entity_type, task_name, task_code,
                status, next_control, frequency_months)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT DO NOTHING`,
            [
              site,
              ent.id,
              entityType,
              `${cat.label} – ${ctrl.type}`,
              taskCode,
              "Planned",
              // Pour le premier contrôle, on utilise firstDate comme 'next_control'
              firstDate,
              freqMonths,
            ]
          );

          if (result.rowCount > 0) {
            created++;
          }
        }
      }

      // ------------------------------
      // 6) Warnings spécifiques catégorie (ex: VSD)
      // ------------------------------
      if (cat.key === "vsd" && vsdLikeMissing.length > 0) {
        warnings.push({
          category_key: cat.key,
          category_label: cat.label,
          type: "vsd_like_without_controls",
          message:
            "Certains équipements ressemblent à des variateurs de vitesse (VSD) mais aucun contrôle TSD 'Variable Speed Drives' n'a pu être appliqué. Vérifier le mapping / la TSD.",
          equipments: vsdLikeMissing,
        });
      }
    }

    await client.query("COMMIT");

    const modeLabel = useAI ? "avec IA" : "sans IA";
    const msg = `Synchronisation OK (${modeLabel}) – ${created} tâches créées pour le site "${site}"`;
    console.log("[Controls][auto-link]", msg);
    res.json({ ok: true, created, message: msg, ai: useAI, warnings });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Controls][auto-link] ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Erreur interne auto-link",
    });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /missing-equipment
// ============================================================================

router.get("/missing-equipment", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const missing = [];
    const existing = [];

    for (const cat of tsdLibrary.categories) {
      const tableName = cat.db_table;
      if (!tableName) continue;

      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [tableName]
      );

      const hasTable = tableCheck[0].exists;
      const countControls = (cat.controls || []).length;

      if (!hasTable) {
        missing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          reason: "table_absente",
          count_controls: countControls,
          count_in_tsd: countControls,
        });
        continue;
      }

      const { rows: colCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'site'
        )`,
        [tableName]
      );
      const hasSiteCol = colCheck[0].exists;

      const { rows: countRows } = await client.query(
        hasSiteCol
          ? `SELECT COUNT(*) as count FROM ${tableName} WHERE site = $1`
          : `SELECT COUNT(*) as count FROM ${tableName}`,
        hasSiteCol ? [site] : []
      );

      const count = parseInt(countRows[0].count, 10) || 0;

      if (count === 0) {
        missing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          reason: "aucun_equipement",
          count_controls: countControls,
          count_in_tsd: countControls,
        });
      } else {
        existing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          count,
          count_controls: countControls,
          count_in_tsd: countControls,
        });
      }
    }

    res.json({ missing, existing });
  } catch (e) {
    console.error("[Controls] missing-equipment error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /tsd  — expose la tsd_library brute (catalogue)
// ============================================================================

router.get("/tsd", async (_req, res) => {
  try {
    res.json(tsdLibrary);
  } catch (e) {
    console.error("[Controls] /tsd error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ROUTES GESTION DES PLANS
// ============================================================================

// Upload ZIP de plans (PDF) vers table controls_plans
router.post("/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const zipBuffer = req.file?.buffer;

    if (!zipBuffer) {
      return res.status(400).json({ error: "No ZIP file" });
    }

    const directory = await unzipper.Open.buffer(zipBuffer);
    let uploadedCount = 0;

    for (const file of directory.files) {
      if (file.type === "Directory") continue;
      if (!file.path.toLowerCase().endsWith(".pdf")) continue;

      const fileName = path.basename(file.path);
      const logicalName = fileName.replace(/\.pdf$/i, "");
      const content = await file.buffer();

      const { rows: existing } = await client.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logicalName, site]
      );

      if (existing.length) {
        await client.query(
          `UPDATE controls_plans 
           SET content = $1, updated_at = NOW()
           WHERE id = $2`,
          [content, existing[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO controls_plans (site, logical_name, display_name, content, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [site, logicalName, logicalName, content]
        );
      }

      uploadedCount++;
    }

    res.json({ success: true, uploaded: uploadedCount });
  } catch (e) {
    console.error("[Controls] uploadZip error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Liste des plans
router.get("/maps/listPlans", async (req, res) => {
  try {
    const site = siteOf(req);

    const { rows } = await pool.query(
      `SELECT id, logical_name, display_name, created_at 
       FROM controls_plans 
       WHERE site = $1 
       ORDER BY display_name`,
      [site]
    );

    res.json({ plans: rows, items: rows });
  } catch (e) {
    console.error("[Controls] listPlans error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Renommer un plan
router.put("/maps/renamePlan", async (req, res) => {
  const { logical_name, display_name } = req.body;
  const site = siteOf(req);

  try {
    await pool.query(
      `UPDATE controls_plans 
       SET display_name = $1 
       WHERE logical_name = $2 AND site = $3`,
      [display_name, logical_name, site]
    );

    res.json({ success: true });
  } catch (e) {
    console.error("[Controls] renamePlan error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Récupération d'un PDF de plan
router.get("/maps/planFile", async (req, res) => {
  const { logical_name, id } = req.query;
  const site = siteOf(req);

  try {
    let query, params;

    if (id) {
      query = `SELECT content FROM controls_plans WHERE id = $1 AND site = $2`;
      params = [id, site];
    } else if (logical_name) {
      query = `SELECT content FROM controls_plans WHERE logical_name = $1 AND site = $2`;
      params = [logical_name, site];
    } else {
      return res.status(400).json({ error: "logical_name or id required" });
    }

    const { rows } = await pool.query(query, params);

    if (!rows.length) {
      console.log(
        `[Controls] Plan not found: id=${id}, logical_name=${logical_name}, site=${site}`
      );
      return res.status(404).json({ error: "Plan not found" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(rows[0].content);
  } catch (e) {
    console.error("[Controls] planFile error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Positions des contrôles sur plan
router.get("/maps/positions", async (req, res) => {
  let { logical_name, building, id, page_index = 0 } = req.query;
  const site = siteOf(req);

  try {
    let planId;

    if (id) {
      planId = id;
    } else if (logical_name) {
      const { rows } = await pool.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logical_name, site]
      );
      if (!rows.length) {
        console.log(
          `[Controls] Plan not found for positions: logical_name=${logical_name}`
        );
        return res.json({ items: [] });
      }
      planId = rows[0].id;
    } else if (building) {
      const { rows } = await pool.query(
        `SELECT id FROM controls_plans 
         WHERE display_name ILIKE $1 AND site = $2 
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length) {
        console.log(
          `[Controls] No plan found for building in positions: ${building}`
        );
        return res.json({ items: [] });
      }
      planId = rows[0].id;
    } else {
      return res.json({ items: [] });
    }

    const { rows: positions } = await pool.query(
      `SELECT 
         ctp.task_id,
         ctp.x_frac,
         ctp.y_frac,
         ct.task_name,
         ct.status,
         ct.next_control,
         ct.entity_id,
         ct.entity_type
       FROM controls_task_positions ctp
       JOIN controls_tasks ct ON ctp.task_id = ct.id
       WHERE ctp.plan_id = $1 
         AND ctp.page_index = $2`,
      [planId, page_index]
    );

    res.json({
      items: positions.map((p) => ({
        task_id: p.task_id,
        entity_id: p.entity_id,
        entity_type: p.entity_type,
        task_name: p.task_name,
        x_frac: Number(p.x_frac),
        y_frac: Number(p.y_frac),
        status: computeStatus(p.next_control),
      })),
    });
  } catch (e) {
    console.error("[Controls] positions error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Définir / mettre à jour la position d'une tâche (ou d'un équipement complet)
router.post("/maps/setPosition", async (req, res) => {
  const {
    task_id,
    entity_id,
    entity_type,
    logical_name,
    building,
    page_index = 0,
    x_frac,
    y_frac,
  } = req.body;
  const site = siteOf(req);

  const client = await pool.connect();
  try {
    let planId;

    // 1) Identifier le plan à partir de logical_name ou building
    if (logical_name) {
      const key = String(logical_name);

      // Si c'est un id numérique OU un UUID → on le traite comme un id de plan
      if (/^\d+$/.test(key) || isUuid(key)) {
        const { rows } = await client.query(
          `SELECT id FROM controls_plans WHERE id = $1 AND site = $2`,
          [key, site]
        );
        if (!rows.length) {
          return res.status(404).json({ error: "Plan not found" });
        }
        planId = rows[0].id;
      } else {
        // Sinon : on considère que c'est un logical_name (comportement historique)
        const { rows } = await client.query(
          `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
          [key, site]
        );
        if (!rows.length) {
          return res.status(404).json({ error: "Plan not found" });
        }
        planId = rows[0].id;
      }
    } else if (building) {
      const { rows } = await client.query(
        `SELECT id FROM controls_plans 
         WHERE display_name ILIKE $1 AND site = $2 
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Plan not found" });
      }
      planId = rows[0].id;
    } else {
      return res.status(400).json({ error: "Missing plan identifier" });
    }

    const pageIndexInt = Number(page_index) || 0;

    // 2) Déterminer les task_id à positionner
    let taskIds = [];

    if (entity_id && entity_type) {
      const { rows: taskRows } = await client.query(
        `SELECT id FROM controls_tasks 
         WHERE entity_id = $1 AND entity_type = $2 AND site = $3`,
        [entity_id, entity_type, site]
      );
      taskIds = taskRows.map((r) => r.id);
    } else if (task_id) {
      taskIds = [task_id];
    }

    // 3) Upsert dans controls_task_positions
    for (const tid of taskIds) {
      const { rows: existing } = await client.query(
        `SELECT id FROM controls_task_positions 
         WHERE task_id = $1 AND plan_id = $2 AND page_index = $3`,
        [tid, planId, pageIndexInt]
      );

      if (existing.length) {
        await client.query(
          `UPDATE controls_task_positions 
           SET x_frac = $1, y_frac = $2, updated_at = NOW()
           WHERE id = $3`,
          [x_frac, y_frac, existing[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO controls_task_positions 
           (task_id, plan_id, page_index, x_frac, y_frac, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [tid, planId, pageIndexInt, x_frac, y_frac]
        );
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[Controls] setPosition error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// MOUNT & BOOT
// ============================================================================

const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const PORT = Number(process.env.CONTROLS_PORT || 3011);
const HOST = process.env.CONTROLS_HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(
    `[Controls] Server running on ${HOST}:${PORT} (BASE_PATH=${BASE_PATH})`
  );
});

export default app;
