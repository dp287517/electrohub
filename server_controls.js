// server_controls.js — Controls Full TSD-Ready
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

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,User');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 8 }
});

// --- CSV helper (pas de dépendance) ---
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

// =====================================================================================
// 1) Référentiel équipements (site/building/type) + “non présent” avec assessment annuel
// =====================================================================================

/**
 * equipment_type: l’un des suivants (couvre le TSD principal)
 *  - HV_SWITCHGEAR (>1000V)
 *  - LV_SWITCHGEAR (<1000V)
 *  - TRANSFORMER_OIL
 *  - TRANSFORMER_RESIN
 *  - PFC_HV
 *  - PFC_LV
 *  - BUSDUCT
 *  - DISTRIBUTION_BOARD
 *  - UPS_SMALL  (<=5kVA)
 *  - UPS_LARGE  (>5kVA)
 *  - BATTERY_SYSTEM
 *  - VSD        (variateurs de fréquence)
 *  - MOTORS_HV
 *  - MOTORS_LV
 *  - ATEX_EQUIPMENT
 *  - EMERGENCY_LIGHTING
 *  - FIRE_ALARM
 */
const EQUIPMENT_TYPES = [
  'HV_SWITCHGEAR','LV_SWITCHGEAR','TRANSFORMER_OIL','TRANSFORMER_RESIN',
  'PFC_HV','PFC_LV','BUSDUCT','DISTRIBUTION_BOARD','UPS_SMALL','UPS_LARGE',
  'BATTERY_SYSTEM','VSD','MOTORS_HV','MOTORS_LV','ATEX_EQUIPMENT',
  'EMERGENCY_LIGHTING','FIRE_ALARM'
];

// Bâtiments connus (expose 92 explicitement)
const BUILDINGS = ['92','B06','B11','B12','B20'];

// Référentiel initial — exemple conforme à ton retour (HV au building 92)
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

// “Non présent” enregistré par site/building/type + assessment annuel
// Quand une famille n’existe pas, on l’inscrit ici pour forcer une vérification annuelle
let NOT_PRESENT_DECL = [
  // exemple: { id: 1, site:'Default', building:'B20', equipment_type:'VSD', declared_by:'Daniel', declared_at:'2025-10-02', last_assessment_at:null, note:'Aucun VSD sur site' }
];

// =====================================================================================
// 2) Librairie TSD — points de contrôle + seuils + périodicités (months)
// =====================================================================================

/**
 * Chaque item = {
 *   id, label, field, type: 'check'|'number'|'text',
 *   unit, comparator: '>=','<=','==','trend','exists','n/a',
 *   threshold: number|string|array,
 *   frequency_months: 3|12|36|60|96...,
 *   hint (facultatif)
 * }
 * On regroupe par equipment_type. On limite ici, mais on couvre les exigences clés.
 */
const TSD_LIBRARY = {
  HV_SWITCHGEAR: [
    // Visuel trimestriel (3 mois)
    { id:'hv_visu_room', label:'Visual: salle propre/sèche, pas d’odeur ni de chaleur anormale', field:'hv_visu_room', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'hv_arc_signs', label:'Absence d’arc/trace (peinture noircie, odeur plastique, etc.)', field:'hv_arc_signs', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    // Thermographie annuelle
    { id:'hv_thermo', label:'Thermographie (busbar, VTs, cable boxes)—pas de point chaud', field:'hv_thermo_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    // Partial discharge annuelle
    { id:'hv_pd', label:'Partial discharge test (UltraTEV) — PASS', field:'hv_pd_pass', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    // CB mécanique annuelle
    { id:'hv_cb_mech', label:'CB: verrouillages / racking / open-close OK', field:'hv_cb_mech', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    // 3–8 ans (on prend 48 mois par défaut) — IR, contact, time-travel
    { id:'hv_ir', label:'IR phase-terre (5000V, 1 min) (GΩ) ≥ 2', field:'hv_ir_go', type:'number', unit:'GΩ', comparator:'>=', threshold:2, frequency_months:48, hint:'TSD: > 2 GΩ' },
    { id:'hv_contact_res_delta', label:'Δ résistance de contact entre pôles (%) ≤ 50', field:'hv_contact_res_delta', type:'number', unit:'%', comparator:'<=', threshold:50, frequency_months:48 },
    { id:'hv_time_travel', label:'Courbe time-travel conforme constructeur', field:'hv_time_travel_ok', type:'check', comparator:'==', threshold:true, frequency_months:48 },
  ],
  LV_SWITCHGEAR: [
    { id:'lv_visu', label:'Visual: propreté, pas d’odeur ni humidité', field:'lv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'lv_trip_settings', label:'Vérif réglages déclencheurs (coordination/étude)', field:'lv_trip_settings', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'lv_ir', label:'IR phases/terre (MΩ) — valeur attendue selon NF/IEC / étude', field:'lv_ir_meas', type:'number', unit:'MΩ', comparator:'>=', threshold:1, frequency_months:36, hint:'≥ 1 MΩ par défaut' },
    { id:'lv_mech', label:'Opération MCCB/ACB, interlocks OK', field:'lv_mech', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  TRANSFORMER_OIL: [
    { id:'tx_visu', label:'Inspection visuelle (fuites, corrosion, terre)', field:'tx_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'tx_oil_bd', label:'Oil BDV (kV) ≥ 26', field:'tx_oil_bdv', type:'number', unit:'kV', comparator:'>=', threshold:26, frequency_months:12 },
    { id:'tx_oil_h2o', label:'Eau dans l’huile (ppm) ≤ 25', field:'tx_oil_h2o', type:'number', unit:'ppm', comparator:'<=', threshold:25, frequency_months:12 },
    { id:'tx_oil_pcb', label:'PCB (ppm) < 50', field:'tx_oil_pcb', type:'number', unit:'ppm', comparator:'<', threshold:50, frequency_months:60 },
    { id:'tx_dga', label:'DGA: pas d’alarme / trend ok', field:'tx_dga_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'tx_ir_hv', label:'IR enroulement HV→terre (GΩ) ≥ 1', field:'tx_ir_hv', type:'number', unit:'GΩ', comparator:'>=', threshold:1, frequency_months:48 },
    { id:'tx_ir_lv', label:'IR enroulement LV→terre (MΩ) ≥ 100', field:'tx_ir_lv', type:'number', unit:'MΩ', comparator:'>=', threshold:100, frequency_months:48 },
  ],
  TRANSFORMER_RESIN: [
    { id:'txr_visu', label:'Inspection visuelle, propreté des bobinages', field:'txr_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'txr_pi', label:'Polarization Index ≥ 1.0', field:'txr_pi', type:'number', comparator:'>=', threshold:1.0, frequency_months:60 },
    { id:'txr_pf', label:'Power Factor (CH/CHL ≤2%, CL ≤5%) — OK', field:'txr_pf_ok', type:'check', comparator:'==', threshold:true, frequency_months:60 },
    { id:'txr_tipup', label:'PF Tip-up ≤ 0.5%', field:'txr_tipup', type:'number', unit:'%', comparator:'<=', threshold:0.5, frequency_months:60 },
  ],
  PFC_HV: [
    { id:'pfchv_mode', label:'Mode auto correct et contrôleur paramétré (PF≈0.95)', field:'pfchv_mode', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'pfchv_visual', label:'Visuel: condensateurs/réacteurs/câbles OK', field:'pfchv_visual', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfchv_caps', label:'Test condition condensateurs: valeurs conformes', field:'pfchv_caps_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfchv_conn', label:'Couples de serrage/connexions conformes', field:'pfchv_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  PFC_LV: [
    { id:'pfclv_mode', label:'Mode auto correct et contrôleur paramétré (PF≈0.95)', field:'pfclv_mode', type:'check', comparator:'==', threshold:true, frequency_months:3 },
    { id:'pfclv_visual', label:'Visuel: condos, ventils, filtres OK', field:'pfclv_visual', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfclv_caps', label:'Capacitances dans tolérances', field:'pfclv_caps_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'pfclv_conn', label:'Couples/connexions conformes', field:'pfclv_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  BUSDUCT: [
    { id:'bus_visu', label:'Inspection visuelle, IP conforme', field:'bus_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bus_conn', label:'Connexions/serrages OK', field:'bus_conn', type:'check', comparator:'==', threshold:true, frequency_months:36 },
  ],
  DISTRIBUTION_BOARD: [
    { id:'db_visu', label:'Visuel: état, IP, absence échauffement', field:'db_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'db_rcd', label:'Essais RCD/DDR (si présents)', field:'db_rcd', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  UPS_SMALL: [
    { id:'ups_s_visu', label:'Visuel/ventilation/alarme OK', field:'ups_s_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_s_batt', label:'Batteries: tension/capacité OK', field:'ups_s_batt', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_s_transfer', label:'Test transfert charge/bypass', field:'ups_s_transfer', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  UPS_LARGE: [
    { id:'ups_l_visu', label:'Visuel/ventilation/alarme OK', field:'ups_l_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_batt', label:'Batteries: capacité (décharge) OK', field:'ups_l_batt', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_transfer', label:'Test transfert charge/bypass', field:'ups_l_transfer', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'ups_l_caps', label:'Santé condensateurs', field:'ups_l_caps', type:'check', comparator:'==', threshold:true, frequency_months:24 },
  ],
  BATTERY_SYSTEM: [
    { id:'bat_visu', label:'Visuel (fuites/corrosion/ventilation)', field:'bat_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bat_cells', label:'Tensions cellules OK', field:'bat_cells_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'bat_capacity', label:'Test de capacité (si critique)', field:'bat_capacity', type:'check', comparator:'==', threshold:true, frequency_months:24 },
  ],
  VSD: [
    { id:'vsd_visu', label:'Visuel: propreté, connexions, ventilation', field:'vsd_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_filters', label:'Nettoyage/remplacement filtres', field:'vsd_filters', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_log', label:'Journaux défauts/anomalies analysés', field:'vsd_log', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'vsd_params', label:'Paramètres (rampe, courant max, etc.) validés', field:'vsd_params', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  MOTORS_HV: [
    { id:'mhv_visu', label:'Visuel (palier, refroidissement)', field:'mhv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mhv_ir', label:'IR stator (GΩ) — tendance stable', field:'mhv_ir', type:'number', unit:'GΩ', comparator:'>=', threshold:1, frequency_months:24 },
    { id:'mhv_vib', label:'Vibrations dans tolérances', field:'mhv_vib_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mhv_temp', label:'Sondes température OK', field:'mhv_temp_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  MOTORS_LV: [
    { id:'mlv_visu', label:'Visuel (palier, refroidissement)', field:'mlv_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'mlv_ir', label:'IR stator (MΩ) — ≥ 1', field:'mlv_ir', type:'number', unit:'MΩ', comparator:'>=', threshold:1, frequency_months:36 },
    { id:'mlv_vib', label:'Vibrations OK', field:'mlv_vib_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  ATEX_EQUIPMENT: [
    { id:'atex_mark', label:'Marquage ATEX conforme zone (G/D & catégorie)', field:'atex_mark_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'atex_ip', label:'IP et intégrité câbles/glands', field:'atex_ip_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'atex_corrosion', label:'Pas de corrosion/contamination', field:'atex_corrosion_ok', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  EMERGENCY_LIGHTING: [
    { id:'el_visu', label:'Visuel: état, signalisation', field:'el_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'el_test', label:'Test autonomie (décharge) conforme', field:'el_test', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ],
  FIRE_ALARM: [
    { id:'fa_visu', label:'Visuel: centrale/détecteurs/câbles', field:'fa_visu', type:'check', comparator:'==', threshold:true, frequency_months:12 },
    { id:'fa_test', label:'Tests fonctionnels boucles/alarme', field:'fa_test', type:'check', comparator:'==', threshold:true, frequency_months:12 },
  ]
};

// =====================================================================================
// 3) Tâches + historique + pièces jointes
// =====================================================================================

let TASKS = [];     // tâches générées/manuel
let HISTORY = [];   // journal de complétion

// Génération automatique: crée des tâches “due” selon last_done et périodicité
// On stocke les dates d’items par équipement dans EQUIP_DONE: { [equipKey]: { [itemId]: 'YYYY-MM-DD' } }
let EQUIP_DONE = {}; // clé = `${equipment_type}:${id}`

// Utils
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
function eqKey(equip) { return `${equip.equipment_type}:${equip.id}`; }

// Moteur de génération : crée les tâches manquantes pour items “due”
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
        // éviter doublons déjà OPEN pour le même item
        const exists = TASKS.find(t =>
          t.status === 'open' &&
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
            due_date: addMonths(now, 0), // due now
            operator: null,
            results: {},
            locked: false,
            attachments: [],
          };
          TASKS.push(t);
          created.push(t.id);
        }
      }
    }
  }

  // Générer aussi une tâche annuelle d’assessment pour chaque NOT_PRESENT
  for (const decl of NOT_PRESENT_DECL.filter(d => d.site === site)) {
    const last = decl.last_assessment_at;
    if (isDue(last, 12)) {
      const exists = TASKS.find(t =>
        t.status === 'open' &&
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
        });
      }
    }
  }
  return created;
}

// Génération initiale
regenerateTasks();

// =====================================================================================
// 4) API
// =====================================================================================

// Health
app.get('/api/controls/health', (_req, res) => res.json({ ok:true, ts:Date.now() }));

// ---- Référentiel équipements
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
  const row = { id: EQUIP_CATALOG.length+1, site, building, equipment_type, name, code: code || null };
  EQUIP_CATALOG.push(row);
  res.status(201).json(row);
});

app.delete('/api/controls/catalog/:id', (req, res) => {
  const id = Number(req.params.id);
  const i = EQUIP_CATALOG.findIndex(e => e.id === id);
  if (i === -1) return res.status(404).json({ error:'Not found' });
  EQUIP_CATALOG.splice(i,1);
  res.json({ success:true });
});

// ---- Déclaration “non présent” + assessment
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
  // re-générer la tâche annuelle si nécessaire
  regenerateTasks(site);
  res.status(201).json(row);
});

app.post('/api/controls/not-present/:id/assess', (req, res) => {
  const row = NOT_PRESENT_DECL.find(d => d.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error:'Not found' });
  row.last_assessment_at = todayISO();
  // close éventuelle tâche NOT_PRESENT ouverte
  const t = TASKS.find(t => t.equipment_type==='NOT_PRESENT' && t.equipment_id===row.id && t.status==='open');
  if (t) {
    t.status='completed'; t.locked=true; t.operator = req.body?.user || 'unknown'; t.results = { note: req.body?.note || '' }; t.completed_at = new Date().toISOString();
    HISTORY.push({ id:HISTORY.length+1, task_id:t.id, user:t.operator, results:t.results, date:t.completed_at });
  }
  res.json({ success:true, row });
});

// ---- Librairie TSD + mapping
app.get('/api/controls/library', (_req,res) => {
  res.json({ types:EQUIPMENT_TYPES, library:TSD_LIBRARY });
});

// ---- Tâches (list/generate)
app.get('/api/controls/tasks', (req, res) => {
  const { site='Default', building, type, status, q } = req.query;
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

// ---- Détails d’une tâche = item TSD + équipement
app.get('/api/controls/tasks/:id/details', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  const equip = EQUIP_CATALOG.find(e => e.id === t.equipment_id && e.equipment_type === t.equipment_type);
  const item = (TSD_LIBRARY[t.equipment_type] || []).find(i => i.id === t.item_id) || null;
  res.json({ ...t, equipment:equip || null, tsd_item:item });
});

// ---- Upload / listing / delete pièces jointes
app.post('/api/controls/tasks/:id/upload', upload.array('files', 8), (req, res) => {
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

// ---- Compléter (validation auto selon TSD)
function evaluate(tsd_item, results) {
  // Retourne {status:'Conforme'|'Non conforme'|'À vérifier', detail:...}
  if (!tsd_item) return { status:'À vérifier', detail:'Pas de règle TSD trouvée' };
  const v = results?.[tsd_item.field];
  switch (tsd_item.type) {
    case 'check': {
      const ok = (v === true);
      return { status: ok ? 'Conforme' : 'Non conforme', detail: ok ? 'OK' : 'Case non cochée' };
    }
    case 'number': {
      const num = Number(v);
      if (isNaN(num)) return { status:'À vérifier', detail:'Valeur numérique manquante' };
      const thr = Number(tsd_item.threshold);
      if (tsd_item.comparator === '>=') return { status: num >= thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs ≥ ${thr}` };
      if (tsd_item.comparator === '<=') return { status: num <= thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs ≤ ${thr}` };
      if (tsd_item.comparator === '<')  return { status: num <  thr ? 'Conforme':'Non conforme', detail:`${num} ${tsd_item.unit||''} vs < ${thr}` };
      if (tsd_item.comparator === '==') return { status: num === thr ? 'Conforme':'Non conforme', detail:`${num} vs == ${thr}` };
      return { status:'À vérifier', detail:'Comparateur non géré' };
    }
    default:
      return { status:'À vérifier', detail:'Type non géré' };
  }
}

app.post('/api/controls/tasks/:id/complete', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error:'Not found' });
  if (t.locked) return res.status(400).json({ error:'Already completed' });

  const user = req.body?.user || 'unknown';
  const results = req.body?.results || {};
  const item = (TSD_LIBRARY[t.equipment_type] || []).find(i => i.id === t.item_id) || null;
  const verdict = evaluate(item, results);

  t.status = 'completed';
  t.locked = true;
  t.operator = user;
  t.results = { ...results, verdict };
  t.completed_at = new Date().toISOString();

  // Marquer la date de réalisation de l’item pour l’équipement
  if (item && t.equipment_type !== 'NOT_PRESENT') {
    const k = eqKey({ equipment_type:t.equipment_type, id:t.equipment_id });
    if (!EQUIP_DONE[k]) EQUIP_DONE[k] = {};
    EQUIP_DONE[k][item.id] = todayISO();
  }
  // Historique
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
  const total = TASKS.length;
  const completed = TASKS.filter(t => t.status==='completed').length;
  const open = total - completed;
  const byBuilding = {};
  const byType = {};
  for (const b of BUILDINGS) byBuilding[b] = TASKS.filter(t => t.building===b).length;
  for (const ty of [...EQUIPMENT_TYPES,'NOT_PRESENT']) byType[ty] = TASKS.filter(t => t.equipment_type===ty).length;
  const gaps = []; // types sans aucun équipement déclarés ni “not present”
  for (const ty of EQUIPMENT_TYPES) {
    const hasEquip = EQUIP_CATALOG.some(e => e.equipment_type===ty);
    const declaredNP = NOT_PRESENT_DECL.some(d => d.equipment_type===ty);
    if (!hasEquip && !declaredNP) gaps.push(ty);
  }
  res.json({ total, open, completed, byBuilding, byType, gaps });
});

// ---- Roadmap (simple, déduit des périodicités; ici statique pour simplicité)
app.get('/api/controls/roadmap', (_req, res) => {
  res.json([
    { id: 1, title: 'Q4 — HV 3–8 ans: IR/Contact/Time Travel', start: '2025-10-01', end: '2025-12-31' },
    { id: 2, title: 'Q4 — Annual: ATEX/UPS/Batteries/VSD',     start: '2025-10-01', end: '2025-12-31' },
  ]);
});

// ---- Assistant IA (stub)
app.post('/api/controls/ai/assistant', (req, res) => {
  const { mode, text } = req.body || {};
  if (mode === 'text') return res.json({ reply:`AI: "${text}" → Pense à vérifier les items TSD et saisir les mesures.` });
  if (mode === 'vision') return res.json({ suggestion:'Lecture photo: tous borniers semblent serrés.' });
  res.status(400).json({ error:'Unknown mode' });
});

// =====================================================================================
// 5) Démarrage
// =====================================================================================
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] server listening on :${port}`));
