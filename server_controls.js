// server_controls.js — Controls Full TSD-Ready + External Sync + Scheduler + Vision Stub
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';

dotenv.config();

const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// ---------------- CORS ----------------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,User');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------------- Upload ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 }
});

// ---------------- Helpers ----------------
function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    const needQuotes = /[",\n]/.test(s);
    const body = s.replace(/"/g, '""');
    return needQuotes ? `"${body}"` : body;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}
function todayISO() { return new Date().toISOString().slice(0,10); }
function addMonths(dateStr, months) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0,10);
}
function isDue(last, freqMonths) {
  if (!last) return true;
  const next = addMonths(last, freqMonths);
  return new Date(next) <= new Date();
}
function isOverdue(dueISO) {
  if (!dueISO) return false;
  return new Date(dueISO) < new Date(todayISO());
}
function eqKey(equip) { return `${equip.equipment_type}:${equip.id}`; }
function log(...args){ if (process.env.CONTROLS_LOG !== '0') console.log('[controls]', ...args); }

// =====================================================================================
// 1) Référentiels (types, bâtiments) + Catalog interne + “Non présent”
// =====================================================================================

const EQUIPMENT_TYPES = [
  'HV_SWITCHGEAR','LV_SWITCHGEAR','TRANSFORMER_OIL','TRANSFORMER_RESIN',
  'PFC_HV','PFC_LV','BUSDUCT','DISTRIBUTION_BOARD','UPS_SMALL','UPS_LARGE',
  'BATTERY_SYSTEM','VSD','MOTORS_HV','MOTORS_LV','ATEX_EQUIPMENT',
  'EMERGENCY_LIGHTING','FIRE_ALARM'
];

const BUILDINGS = ['92','B06','B11','B12','B20'];

// Catalog interne (se remplit aussi par sync externe)
let EQUIP_CATALOG = [
  { id: 1, site: 'Default', building: '92',  equipment_type: 'HV_SWITCHGEAR', name: 'HV Room A', code: 'HV-92-A' },
  { id: 2, site: 'Default', building: '92',  equipment_type: 'TRANSFORMER_OIL', name: 'TX-1 Oil 2MVA', code: 'TX1-OIL' },
  { id: 3, site: 'Default', building: '92',  equipment_type: 'PFC_HV', name: 'PFC HV Bank', code: 'PFC-HV-1' },
  { id: 4, site: 'Default', building: 'B06', equipment_type: 'LV_SWITCHGEAR', name: 'Main LV Board M1', code: 'LV-M1' },
  { id: 5, site: 'Default', building: 'B06', equipment_type: 'DISTRIBUTION_BOARD', name: 'DB-Prod-1', code: 'DB-P1' },
  { id: 6, site: 'Default', building: 'B11', equipment_type: 'ATEX_EQUIPMENT', name: 'Mixer Z22', code: 'ATEX-22-01' },
  { id: 7, site: 'Default', building: 'B11', equipment_type: 'UPS_LARGE', name: 'UPS 40kVA QA', code: 'UPS-40-QA' },
  { id: 8, site: 'Default', building: 'B12', equipment_type: 'VSD', name: 'VFD-Granulator-1', code: 'VFD-G1' },
];

// “Non présent” (déclaration + assessment annuel)
let NOT_PRESENT_DECL = [];

// =====================================================================================
// 2) TSD — Bibliothèque des points de contrôle (condensée mais complète par familles clés)
// =====================================================================================

const TSD_LIBRARY = {
  HV_SWITCHGEAR: [
    { id:'hv_visu_room', label:'Visual: salle propre/sèche, pas d’odeur ni de chaleur anormale', field:'hv_visu_room', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'hv_arc_signs', label:'Absence d’arc/trace', field:'hv_arc_signs', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'hv_thermo', label:'Thermographie — pas de point chaud', field:'hv_thermo_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'hv_pd', label:'Partial discharge (UltraTEV) — PASS', field:'hv_pd_pass', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'hv_cb_mech', label:'CB: interlocks/racking/open-close OK', field:'hv_cb_mech', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'hv_ir', label:'IR phase-terre (GΩ) ≥ 2', field:'hv_ir_go', type:'number', unit:'GΩ', comparator:'>=', threshold:2, frequency_months:48 },
    { id:'hv_contact_res_delta', label:'Δ résistance de contact (%) ≤ 50', field:'hv_contact_res_delta', type:'number', unit:'%', comparator:'<=', threshold:50, frequency_months:48 },
    { id:'hv_time_travel', label:'Courbe time-travel conforme', field:'hv_time_travel_ok', type:'check', comparator:'==', threshold:true, frequency_months:48 },
  ],
  LV_SWITCHGEAR: [
    { id:'lv_visu', label:'Visuel: propreté/odeur/humidité', field:'lv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'lv_trip_settings', label:'Réglages déclencheurs validés', field:'lv_trip_settings', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'lv_ir_meas', label:'IR (MΩ) ≥ 1', field:'lv_ir_meas', type:'number', unit:'MΩ', comparator:'>=', threshold:1, frequency_months:36 },
    { id:'lv_mech', label:'Opération MCCB/ACB/interlocks', field:'lv_mech', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  TRANSFORMER_OIL: [
    { id:'tx_visu', label:'Fuites/corrosion/terre OK', field:'tx_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'tx_oil_bdv', label:'BDV (kV) ≥ 26', field:'tx_oil_bdv', type:'number', unit:'kV', comparator:'>=', threshold:26, frequency_months:12 },
    { id:'tx_oil_h2o', label:'Eau (ppm) ≤ 25', field:'tx_oil_h2o', type:'number', unit:'ppm', comparator:'<=', threshold:25, frequency_months:12 },
    { id:'tx_oil_pcb', label:'PCB (ppm) < 50', field:'tx_oil_pcb', type:'number', unit:'ppm', comparator:'<', threshold:50, frequency_months:60 },
    { id:'tx_dga_ok', label:'DGA OK / pas d’alarme', field:'tx_dga_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'tx_ir_hv', label:'IR HV→terre (GΩ) ≥ 1', field:'tx_ir_hv', type:'number', unit:'GΩ', comparator:'>=', threshold:1, frequency_months:48 },
    { id:'tx_ir_lv', label:'IR LV→terre (MΩ) ≥ 100', field:'tx_ir_lv', type:'number', unit:'MΩ', comparator:'>=', threshold:100, frequency_months:48 },
  ],
  TRANSFORMER_RESIN: [
    { id:'txr_visu', label:'Propreté bobinages', field:'txr_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'txr_pi', label:'PI ≥ 1.0', field:'txr_pi', type:'number', comparator:'>=', threshold:1.0, frequency_months:60 },
    { id:'txr_pf_ok', label:'PF CH/CHL ≤2%, CL ≤5%', field:'txr_pf_ok', type:'check', comparator:'==', threshold:true, frequency_months:60 },
    { id:'txr_tipup', label:'PF Tip-up ≤ 0.5%', field:'txr_tipup', type:'number', unit:'%', comparator:'<=', threshold:0.5, frequency_months:60 },
  ],
  PFC_HV: [
    { id:'pfchv_mode', label:'Mode auto correct (PF≈0.95)', field:'pfchv_mode', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'pfchv_visual', label:'Condos/réacteurs/câbles OK', field:'pfchv_visual', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfchv_caps_ok', label:'Capacitances conformes', field:'pfchv_caps_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfchv_conn', label:'Serrages conformes', field:'pfchv_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  PFC_LV: [
    { id:'pfclv_mode', label:'Mode auto correct (PF≈0.95)', field:'pfclv_mode', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'pfclv_visual', label:'Condos/ventils/filtres OK', field:'pfclv_visual', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfclv_caps_ok', label:'Capacitances conformes', field:'pfclv_caps_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfclv_conn', label:'Serrages conformes', field:'pfclv_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  BUSDUCT: [
    { id:'bus_visu', label:'IP conforme / visuel OK', field:'bus_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bus_conn', label:'Connexions serrées', field:'bus_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  DISTRIBUTION_BOARD: [
    { id:'db_visu', label:'État / IP / pas d’échauffement', field:'db_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'db_rcd', label:'Essais RCD/DDR (si présents)', field:'db_rcd', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  UPS_SMALL: [
    { id:'ups_s_visu', label:'Visuel/ventilation/alarme', field:'ups_s_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_s_batt', label:'Batteries OK', field:'ups_s_batt', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_s_transfer', label:'Test transfert OK', field:'ups_s_transfer', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  UPS_LARGE: [
    { id:'ups_l_visu', label:'Visuel/ventilation/alarme', field:'ups_l_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_batt', label:'Capacité OK', field:'ups_l_batt', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_transfer', label:'Transfert OK', field:'ups_l_transfer', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_caps', label:'Santé condensateurs', field:'ups_l_caps', type:'check', comparator:'==', threshold:true, frequency_months:24 },
  ],
  BATTERY_SYSTEM: [
    { id:'bat_visu', label:'Fuites/corrosion/ventilation', field:'bat_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bat_cells_ok', label:'Tensions cellules OK', field:'bat_cells_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bat_capacity', label:'Test capacité (si critique)', field:'bat_capacity', type:'check', comparator:'==', threshold:true, frequency_months:24 },
  ],
  VSD: [
    { id:'vsd_visu', label:'Propreté/connexions/ventilation', field:'vsd_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_filters', label:'Filtres OK', field:'vsd_filters', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_log', label:'Journal défauts analysé', field:'vsd_log', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_params', label:'Paramètres validés', field:'vsd_params', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  MOTORS_HV: [
    { id:'mhv_visu', label:'Palier / refroidissement', field:'mhv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mhv_ir', label:'IR stator (GΩ) ≥ 1', field:'mhv_ir', type:'number', unit:'GΩ', comparator:'>=', threshold:1, frequency_months:24 },
    { id:'mhv_vib_ok', label:'Vibrations OK', field:'mhv_vib_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mhv_temp_ok', label:'Sondes température OK', field:'mhv_temp_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  MOTORS_LV: [
    { id:'mlv_visu', label:'Palier / refroidissement', field:'mlv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mlv_ir', label:'IR stator (MΩ) ≥ 1', field:'mlv_ir', type:'number', unit:'MΩ', comparator:'>=', threshold:1, frequency_months:36 },
    { id:'mlv_vib_ok', label:'Vibrations OK', field:'mlv_vib_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  ATEX_EQUIPMENT: [
    { id:'atex_mark_ok', label:'Marquage ATEX conforme zone', field:'atex_mark_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'atex_ip_ok', label:'IP / câbles / glands OK', field:'atex_ip_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'atex_corrosion_ok', label:'Pas de corrosion', field:'atex_corrosion_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  EMERGENCY_LIGHTING: [
    { id:'el_visu', label:'État / signalisation', field:'el_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'el_test', label:'Test autonomie conforme', field:'el_test', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  FIRE_ALARM: [
    { id:'fa_visu', label:'Centrale / détecteurs / câbles', field:'fa_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'fa_test', label:'Tests boucles / alarme', field:'fa_test', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
};

// =====================================================================================
// 3) Tâches + historique + pièces jointes + “faits par équipement”
// =====================================================================================

let TASKS = [];
let HISTORY = [];
let EQUIP_DONE = {}; // { "<type>:<id>": { "<itemId>": "YYYY-MM-DD" } }

// -------------------------------------------------------------------------------------
// 4) Adapters: Switchboards / HV / ATEX — Vérifie qu’on appelle bien les bonnes données
// -------------------------------------------------------------------------------------

const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL || 'http://localhost:3012';
const HV_URL         = process.env.HV_URL         || 'http://localhost:3013';
const ATEX_URL       = process.env.ATEX_URL       || 'http://localhost:3014';

// Utilise fetch natif Node >=18
async function safeFetchJson(url, options = {}) {
  try {
    const r = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers||{}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log('fetch error:', url, e.message);
    return null;
  }
}

// ---- Switchboards: attend un endpoint listant tableaux & devices
async function loadSwitchboards(site='Default'){
  const data = await safeFetchJson(`${SWITCHBOARD_URL}/api/switchboards?site=${encodeURIComponent(site)}`);
  if (!data || !Array.isArray(data)) return [];
  // mapping -> DISTRIBUTION_BOARD & LV_SWITCHGEAR
  const rows = [];
  data.forEach(sb=>{
    const building = sb.building || sb.location?.building || 'B06';
    const name = sb.name || sb.code || `Board-${sb.id}`;
    const code = sb.code || `SB-${sb.id}`;
    const type = (sb.kind === 'MAIN_LV' || sb.is_main) ? 'LV_SWITCHGEAR' : 'DISTRIBUTION_BOARD';
    rows.push({ id:`SB-${sb.id}`, site, building, equipment_type:type, name, code });
  });
  return rows;
}

// ---- High Voltage
async function loadHV(site='Default'){
  const data = await safeFetchJson(`${HV_URL}/api/hv/list?site=${encodeURIComponent(site)}`);
  if (!data || !Array.isArray(data)) return [];
  const rows = data.map(hv=>{
    const building = hv.building || hv.location?.building || '92';
    const name = hv.name || hv.panel || `HV-${hv.id}`;
    const code = hv.code || `HV-${hv.id}`;
    return { id:`HV-${hv.id}`, site, building, equipment_type:'HV_SWITCHGEAR', name, code };
  });
  return rows;
}

// ---- ATEX
async function loadATEX(site='Default'){
  const data = await safeFetchJson(`${ATEX_URL}/api/atex/equipments?site=${encodeURIComponent(site)}`);
  if (!data || !Array.isArray(data)) return [];
  const rows = data.map(ax=>{
    const building = ax.building || ax.location?.building || 'B11';
    const name = ax.name || ax.reference || `ATEX-${ax.id}`;
    const code = ax.code || `ATEX-${ax.id}`;
    return { id:`ATX-${ax.id}`, site, building, equipment_type:'ATEX_EQUIPMENT', name, code };
  });
  return rows;
}

// ---- Sync global: fusionne sans dupliquer (clé unique: site+id+type)
async function syncAllExternal(site='Default'){
  const [sb, hv, atex] = await Promise.all([loadSwitchboards(site), loadHV(site), loadATEX(site)]);
  const incoming = [...sb, ...hv, ...atex];
  let added = 0, updated = 0;
  for (const inc of incoming){
    if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) continue;
    const idx = EQUIP_CATALOG.findIndex(e => (e.site===inc.site && e.equipment_type===inc.equipment_type && String(e.id)===String(inc.id)));
    if (idx === -1){
      EQUIP_CATALOG.push(inc); added++;
    } else {
      const prev = EQUIP_CATALOG[idx];
      if (prev.name!==inc.name || prev.code!==inc.code || prev.building!==inc.building){
        EQUIP_CATALOG[idx] = { ...prev, ...inc }; updated++;
      }
    }
  }
  return { added, updated, total: incoming.length };
}

// =====================================================================================
// 5) Génération des tâches (incl. NOT_PRESENT) + statut Overdue
// =====================================================================================

function ensureOverdueFlags(){
  for (const t of TASKS){
    if (t.status === 'open' && isOverdue(t.due_date)) t.status = 'overdue';
  }
}

function regenerateTasks(site='Default') {
  const now = todayISO();
  const created = [];
  for (const equip of EQUIP_CATALOG.filter(e => e.site === site)) {
    const items = TSD_LIBRARY[equip.equipment_type] || [];
    const k = eqKey(equip);
    if (!EQUIP_DONE[k]) EQUIP_DONE[k] = {};
    for (const it of items) {
      const last = EQUIP_DONE[k][it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const exists = TASKS.find(t =>
          (t.status === 'open' || t.status==='overdue') &&
          t.equipment_type === equip.equipment_type &&
          t.equipment_id === equip.id &&
          t.item_id === it.id
        );
        if (!exists) {
          const t = {
            id: TASKS.length + 1,
            site,
            building: equip.building,
            title: `${equip.name} • ${it.label}`,
            equipment_type: equip.equipment_type,
            equipment_id: equip.id,
            equipment_code: equip.code,
            item_id: it.id,
            status: 'open',
            created_at: new Date().toISOString(),
            due_date: now, // due now
            operator: null,
            results: {},
            locked: false,
            attachments: [],
            ai_risk_score: null,
          };
          TASKS.push(t);
          created.push(t.id);
        }
      }
    }
  }
  // NOT_PRESENT — assessment annuel
  for (const decl of NOT_PRESENT_DECL.filter(d => d.site === site)) {
    const last = decl.last_assessment_at;
    if (isDue(last, 12)) {
      const exists = TASKS.find(t =>
        (t.status === 'open' || t.status==='overdue') &&
        t.equipment_type === 'NOT_PRESENT' &&
        t.equipment_id === decl.id
      );
      if (!exists) {
        TASKS.push({
          id: TASKS.length + 1,
          site,
          building: decl.building,
          title: `[Assessment annuel] ${decl.equipment_type} — déclaré non présent`,
          equipment_type: 'NOT_PRESENT',
          equipment_id: decl.id,
          equipment_code: `NP-${decl.building}-${decl.equipment_type}`,
          item_id: 'annual_assessment',
          status: 'open',
          created_at: new Date().toISOString(),
          due_date: todayISO(),
          operator: null,
          results: {},
          locked: false,
          attachments: [],
          ai_risk_score: null,
        });
      }
    }
  }
  ensureOverdueFlags();
  return created;
}

// =====================================================================================
// 6) Évaluations TSD + intégration risk score (vision) dans le verdict
// =====================================================================================

function evaluate(tsd_item, results, aiRiskScore = null) {
  // Retourne {status:'Conforme'|'Non conforme'|'À vérifier', detail:...}
  if (!tsd_item) return { status:'À vérifier', detail:'Pas de règle TSD trouvée' };

  // Si on a un score IA élevé, on passe en "À vérifier" si TSD dit conforme
  const RISK_THRESHOLD = Number(process.env.AI_RISK_THRESHOLD || 0.7);

  const v = results?.[tsd_item.field];
  let baseVerdict;
  switch (tsd_item.type) {
    case 'check': {
      const ok = (v === true);
      baseVerdict = { status: ok ? 'Conforme' : 'Non conforme', detail: ok ? 'OK' : 'Case non cochée' };
      break;
    }
    case 'number': {
      const num = Number(v);
      if (isNaN(num)) baseVerdict = { status:'À vérifier', detail:'Valeur numérique manquante' };
      else {
        const thr = Number(tsd_item.threshold);
        if (tsd_item.comparator === '>=') baseVerdict = { status: num >= thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs ≥ ${thr}` };
        else if (tsd_item.comparator === '<=') baseVerdict = { status: num <= thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs ≤ ${thr}` };
        else if (tsd_item.comparator === '<')  baseVerdict = { status: num <  thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs < ${thr}` };
        else if (tsd_item.comparator === '==') baseVerdict = { status: num === thr ? 'Conforme':'Non conforme', detail:`${num} vs == ${thr}` };
        else baseVerdict = { status:'À vérifier', detail:'Comparateur non géré' };
      }
      break;
    }
    default:
      baseVerdict = { status:'À vérifier', detail:'Type non géré' };
  }

  if (aiRiskScore != null && aiRiskScore >= RISK_THRESHOLD && baseVerdict.status === 'Conforme') {
    return { status: 'À vérifier', detail: `Score IA risque ${aiRiskScore.toFixed(2)} ≥ seuil ${RISK_THRESHOLD}` };
  }
  return baseVerdict;
}

// =====================================================================================
// 7) API
// =====================================================================================

// Health
app.get('/api/controls/health', (_req, res) => res.json({ ok:true, ts:Date.now() }));

// ---- Sync externe (Switchboard / HV / ATEX)
app.post('/api/controls/sync', async (req, res) => {
  const site = req.body?.site || 'Default';
  const r = await syncAllExternal(site);
  // regen des tâches après sync
  const created = regenerateTasks(site);
  res.json({ synced:r, tasks_created: created.length });
});

// ---- Catalog équipements
app.get('/api/controls/catalog', (req, res) => {
  const { site='Default', building, type } = req.query;
  let rows = EQUIP_CATALOG.filter(e => e.site === site);
  if (building) rows = rows.filter(e => e.building === building);
  if (type) rows = rows.filter(e => e.equipment_type === type);
  res.json({ data: rows, types: EQUIPMENT_TYPES, buildings: BUILDINGS });
});

app.post('/api/controls/catalog', (req, res) => {
  const { site='Default', building, equipment_type, name, code } = req.body || {};
  if (!building || !equipment_type || !name) return res.status(400).json({ error:'Missing fields' });
  if (!EQUIPMENT_TYPES.includes(equipment_type)) return res.status(400).json({ error:'Unknown equipment_type' });
  const row = { id: String(Date.now()), site, building, equipment_type, name, code: code || null };
  EQUIP_CATALOG.push(row);
  res.status(201).json(row);
});

app.delete('/api/controls/catalog/:id', (req, res) => {
  const id = String(req.params.id);
  const i = EQUIP_CATALOG.findIndex(e => String(e.id) === id);
  if (i === -1) return res.status(404).json({ error:'Not found' });
  EQUIP_CATALOG.splice(i,1);
  res.json({ success:true });
});

// ---- Déclaration Non Présent
app.get('/api/controls/not-present', (req, res) => {
  const { site='Default', building } = req.query;
  let rows = NOT_PRESENT_DECL.filter(d => d.site === site);
  if (building) rows = rows.filter(d => d.building === building);
  res.json(rows);
});

app.post('/api/controls/not-present', (req, res) => {
  const { site='Default', building, equipment_type, declared_by, note } = req.body || {};
  if (!building || !equipment_type) return res.status(400).json({ error:'Missing fields' });
  if (!EQUIPMENT_TYPES.includes(equipment_type)) return res.status(400).json({ error:'Unknown equipment_type' });
  const exists = NOT_PRESENT_DECL.find(d => d.site===site && d.building===building && d.equipment_type===equipment_type);
  if (exists) return res.status(409).json({ error:'Already declared' });
  const row = {
    id: NOT_PRESENT_DECL.length + 1,
    site, building, equipment_type, declared_by: declared_by || 'unknown',
    declared_at: new Date().toISOString(),
    last_assessment_at: null,
    note: note || ''
  };
  NOT_PRESENT_DECL.push(row);
  regenerateTasks(site);
  res.status(201).json(row);
});

app.post('/api/controls/not-present/:id/assess', (req, res) => {
  const row = NOT_PRESENT_DECL.find(d => d.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error:'Not found' });
  row.last_assessment_at = todayISO();
  const t = TASKS.find(t => t.equipment_type==='NOT_PRESENT' && t.equipment_id===row.id && (t.status==='open'||t.status==='overdue'));
  if (t) {
    t.status='completed'; t.locked=true; t.operator = req.body?.user || 'unknown'; t.results = { note: req.body?.note || '', verdict:{status:'Conforme', detail:'Assessment réalisé'} }; t.completed_at = new Date().toISOString();
    HISTORY.push({ id:HISTORY.length+1, task_id:t.id, user:t.operator, results:t.results, date:t.completed_at });
  }
  res.json({ success:true, row });
});

// ---- Librairie TSD
app.get('/api/controls/library', (_req,res) => {
  res.json({ types:EQUIPMENT_TYPES, library:TSD_LIBRARY });
});

// ---- Tâches: list / generate / details
app.get('/api/controls/tasks', (req, res) => {
  const { site='Default', building, type, status, q } = req.query;
  ensureOverdueFlags();
  let rows = TASKS.filter(t => (t.site || 'Default') === site);
  if (building) rows = rows.filter(t => t.building === building);
  if (type) rows = rows.filter(t => t.equipment_type === type);
  if (status) rows = rows.filter(t => t.status === status);
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(t => (t.title||'').toLowerCase().includes(s) || (t.equipment_code||'').toLowerCase().includes(s));
  }
  res.json(rows);
});

app.post('/api/controls/generate', (req, res) => {
  const site = req.body?.site || 'Default';
  const created = regenerateTasks(site);
  res.json({ created });
});

app.get('/api/controls/tasks/:id/details', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  const equip = EQUIP_CATALOG.find(e => String(e.id) === String(t.equipment_id) && e.equipment_type === t.equipment_type);
  const item = (TSD_LIBRARY[t.equipment_type] || []).find(i => i.id === t.item_id) || null;
  res.json({ ...t, equipment:equip || null, tsd_item:item });
});

// ---- Pièces jointes
app.post('/api/controls/tasks/:id/upload', upload.array('files', 12), (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  if (t.locked) return res.status(400).json({ error:'Task is locked' });
  const files = (req.files||[]).map(f => ({
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}_${f.originalname}`,
    filename: f.originalname, size: f.size, mimetype: f.mimetype, buffer:f.buffer, uploaded_at: new Date().toISOString()
  }));
  t.attachments.push(...files);
  res.json({ uploaded: files.length });
});

app.get('/api/controls/tasks/:id/attachments', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  const list = t.attachments.map(a => ({ id:a.id, filename:a.filename, size:a.size, mimetype:a.mimetype, uploaded_at:a.uploaded_at }));
  res.json(list);
});

app.delete('/api/controls/attachments/:attId', (req, res) => {
  for (const t of TASKS) {
    const i = t.attachments.findIndex(a => a.id === req.params.attId);
    if (i !== -1) { t.attachments.splice(i,1); return res.json({ success:true }); }
  }
  res.status(404).json({ error:'Not found' });
});

// ---- IA Vision: score de risque basique et étiquettes (stub prêt pour modèle CV)
app.post('/api/controls/ai/vision-score', upload.array('files', 8), (req, res) => {
  const hints = (req.body?.hints || '').toLowerCase();
  const files = req.files || [];
  let score = 0.15; // base faible
  const tags = new Set();

  // Heuristiques simples (remplaçables par un vrai modèle)
  const bump = (v)=>{ score = Math.min(1, score + v); };
  if (/hot|burn|scorch|black|smoke|char/.test(hints)) { bump(0.25); tags.add('échauffement'); }
  if (/loose|unfixed|open|ip20|door-open/.test(hints)) { bump(0.2); tags.add('IP/ouverture'); }
  if (/corrosion|rust|oxid/.test(hints)) { bump(0.2); tags.add('corrosion'); }
  if (/atex|zone 1|zone 21|gas|dust/.test(hints)) { bump(0.1); tags.add('ATEX'); }

  files.forEach(f=>{
    const nm = (f.originalname||'').toLowerCase();
    if (/burn|hot|thermo/.test(nm)) { bump(0.15); tags.add('thermo-signal'); }
    if (/rust|oxide/.test(nm)) { bump(0.15); tags.add('corrosion'); }
    if (/open|door/.test(nm)) { bump(0.1); tags.add('ouverture'); }
  });

  res.json({ ai_risk_score: Number(score.toFixed(2)), tags: Array.from(tags) });
});

// ---- Compléter une tâche (intègre ai_risk_score si fourni)
app.post('/api/controls/tasks/:id/complete', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  if (t.locked) return res.status(400).json({ error:'Already completed' });

  const user = req.body?.user || 'unknown';
  const results = req.body?.results || {};
  const ai_risk_score = (req.body?.ai_risk_score!=null) ? Number(req.body.ai_risk_score) : t.ai_risk_score;

  const item = (TSD_LIBRARY[t.equipment_type] || []).find(i => i.id === t.item_id) || null;
  const verdict = evaluate(item, results, ai_risk_score);

  t.status = 'completed';
  t.locked = true;
  t.operator = user;
  t.results = { ...results, verdict, ai_risk_score };
  t.completed_at = new Date().toISOString();
  t.ai_risk_score = ai_risk_score ?? null;

  if (item && t.equipment_type !== 'NOT_PRESENT') {
    const k = eqKey({ equipment_type:t.equipment_type, id:t.equipment_id });
    if (!EQUIP_DONE[k]) EQUIP_DONE[k] = {};
    EQUIP_DONE[k][item.id] = todayISO();
  }
  HISTORY.push({ id:HISTORY.length+1, task_id:t.id, user, results:t.results, date:t.completed_at });

  res.json({ message:'Task completed', verdict });
});

// ---- Historique & export
app.get('/api/controls/history', (req, res) => {
  const { user, q } = req.query;
  let rows = [...HISTORY];
  if (user) rows = rows.filter(h => h.user === user);
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(h => JSON.stringify(h.results||{}).toLowerCase().includes(s));
  }
  res.json(rows);
});

app.get('/api/controls/history/export', (_req, res) => {
  const csv = toCSV(HISTORY);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=controls_history.csv');
  res.send(csv);
});

// ---- Analytics
app.get('/api/controls/analytics', (_req, res) => {
  ensureOverdueFlags();
  const total = TASKS.length;
  const completed = TASKS.filter(t => t.status==='completed').length;
  const open = TASKS.filter(t => t.status==='open').length;
  const overdue = TASKS.filter(t => t.status==='overdue').length;
  const byBuilding = {};
  const byType = {};
  for (const b of BUILDINGS) byBuilding[b] = TASKS.filter(t => t.building===b).length;
  for (const ty of [...EQUIPMENT_TYPES,'NOT_PRESENT']) byType[ty] = TASKS.filter(t => t.equipment_type===ty).length;

  const gaps = []; // familles sans équipement ni déclaration "non présent"
  for (const ty of EQUIPMENT_TYPES) {
    const hasEquip = EQUIP_CATALOG.some(e => e.equipment_type===ty);
    const declaredNP = NOT_PRESENT_DECL.some(d => d.equipment_type===ty);
    if (!hasEquip && !declaredNP) gaps.push(ty);
  }

  res.json({ total, open, completed, overdue, byBuilding, byType, gaps });
});

// ---- Roadmap (exemple)
app.get('/api/controls/roadmap', (_req, res) => {
  res.json([
    { id: 1, title: 'Q4 — HV 3–8 ans: IR/Contact/Time Travel', start: '2025-10-01', end: '2025-12-31' },
    { id: 2, title: 'Q4 — Annual: ATEX/UPS/Batteries/VSD',     start: '2025-10-01', end: '2025-12-31' },
  ]);
});

// ---- Assistant IA (stub texte + vision courte)
app.post('/api/controls/ai/assistant', (req, res) => {
  const { mode, text } = req.body || {};
  if (mode === 'text') return res.json({ reply:`AI: "${text}" → Pense à vérifier les items TSD et saisir les mesures.` });
  if (mode === 'vision') return res.json({ suggestion:'Lecture photo: borniers semblent serrés.' });
  res.status(400).json({ error:'Unknown mode' });
});

// =====================================================================================
// 8) Scheduler quotidien (Overdue + notifications) — in-process
// =====================================================================================

const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK || null;
async function notify(payload){
  if (!ALERT_WEBHOOK) return;
  try{
    await fetch(ALERT_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  }catch(e){ log('notify error', e.message); }
}

function dailyMaintenance(){
  ensureOverdueFlags();
  const overdue = TASKS.filter(t => t.status==='overdue').map(t => ({ id:t.id, title:t.title, building:t.building, type:t.equipment_type, due_date:t.due_date }));
  if (overdue.length){
    notify({ type:'controls.overdue', at:new Date().toISOString(), count: overdue.length, items: overdue.slice(0,50) });
    log(`overdue: ${overdue.length}`);
  }
  // Regénérer (au cas où nouveaux items deviennent due aujourd’hui)
  regenerateTasks('Default');
  log('daily maintenance done');
}

// Lancement job: toutes les 6h (et au démarrage)
const SIX_HOURS = 6 * 60 * 60 * 1000;
setTimeout(dailyMaintenance, 5 * 1000);
setInterval(dailyMaintenance, SIX_HOURS);

// =====================================================================================
// 9) Démarrage
// =====================================================================================
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] server listening on :${port}`));
