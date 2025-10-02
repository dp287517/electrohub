// server_controls.js — Controls Full TSD-Ready + External Sync + Scheduler + Vision with OpenAI
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import pg from 'pg';
import OpenAI from 'openai';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// OpenAI setup
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn('[CONTROLS] No OPENAI_API_KEY found');
}

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

function log(...args) { if (process.env.CONTROLS_LOG !== '0') console.log('[controls]', ...args); }

// =====================================================================================
// 1) Référentiels (types, bâtiments) + Catalog interne + “Non présent”
// =====================================================================================

const EQUIPMENT_TYPES = [
  'EARTHING_SYSTEM', 'HV_SWITCHGEAR', 'LV_SWITCHGEAR', 'TRANSFORMER_OIL', 'TRANSFORMER_RESIN',
  'PFC_HV', 'PFC_LV', 'BUSDUCT', 'DISTRIBUTION_BOARD', 'UPS_SMALL', 'UPS_LARGE',
  'BATTERY_SYSTEM', 'VSD', 'MOTORS_HV', 'MOTORS_LV', 'ATEX_EQUIPMENT',
  'EMERGENCY_LIGHTING', 'FIRE_ALARM'
];

const BUILDINGS = ['92', 'B06', 'B11', 'B12', 'B20'];

// TSD — Bibliothèque des points de contrôle (complète basée sur TSD PDF)
const TSD_LIBRARY = {
  EARTHING_SYSTEM: [
    { id: 'earth_electrode_inspection', label: 'Termination of earthing conductors must be inspected for security and, where applicable, for soundness of any protective finish.', field: 'earth_electrode_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'earth_electrode_testing', label: 'All earth electrodes need to be tested to ensure that good contact is made with the general mass of earth.', field: 'earth_electrode_resistance', type: 'number', unit: 'Ω', comparator: '<=', threshold: 100, frequency_months: 60 },
    { id: 'earthing_conductor_inspection', label: 'All protective and bonding conductor connections must be inspected to ensure all joints and connections are sound and secure.', field: 'earthing_conductor_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'earthing_conductor_testing', label: 'All protective and bonding conductors must be periodically tested to ensure that they are electrically safe and correctly connected.', field: 'earthing_conductor_testing', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'earth_system_resistance_check', label: 'At each stage of the electrical distribution system a check must be made of the entire earthing system resistance value.', field: 'earth_system_resistance', type: 'number', unit: 'Ω', comparator: '<=', threshold: 10, frequency_months: 60 },
    { id: 'lightning_protection_inspection', label: 'Lightning protection systems must be inspected to ensure the following components are sound and secure, with special attention paid to signs of corrosion.', field: 'lightning_protection_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'lightning_protection_test', label: 'All lightning protection systems must be tested for continuity using a low resistance milli-ohmmeter.', field: 'lightning_protection_test', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'electrostatic_discharge_inspection', label: 'Static earthing systems must be inspected to ensure the following components are sound and secure, with special attention paid to signs of corrosion.', field: 'electrostatic_discharge_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'electrostatic_discharge_test', label: 'All static earthing conductors and joints must be tested for continuity from plant item to earth link using a low resistance ohmmeter.', field: 'electrostatic_discharge_test', type: 'check', comparator: '==', threshold: true, frequency_months: 12 }
  ],
  HV_SWITCHGEAR: [
    { id: 'hv_visu_room', label: 'Visual: salle propre/sèche, pas d’odeur ni de chaleur anormale', field: 'hv_visu_room', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'hv_arc_signs', label: 'Absence d’arc/trace', field: 'hv_arc_signs', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'hv_relay_indications', label: 'Relay indications (flags)', field: 'hv_relay_indications', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'hv_voltage_readings', label: 'Voltage readings where possible', field: 'hv_voltage_readings', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'hv_current_readings', label: 'Current readings where possible', field: 'hv_current_readings', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'hv_thermo', label: 'Thermographie — pas de point chaud', field: 'hv_thermo_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'hv_pd', label: 'Partial discharge (UltraTEV) — PASS', field: 'hv_pd_pass', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'hv_cb_mech', label: 'CB: interlocks/racking/open-close OK', field: 'hv_cb_mech', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'hv_ir', label: 'IR phase-terre (GΩ) ≥ 2', field: 'hv_ir_go', type: 'number', unit: 'GΩ', comparator: '>=', threshold: 2, frequency_months: 96 },
    { id: 'hv_contact_res_delta', label: 'Δ résistance de contact (%) ≤ 50', field: 'hv_contact_res_delta', type: 'number', unit: '%', comparator: '<=', threshold: 50, frequency_months: 96 },
    { id: 'hv_time_travel', label: 'Courbe time-travel conforme', field: 'hv_time_travel_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'hv_vt_visual', label: 'Visual inspection of voltage transformers', field: 'hv_vt_visual', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'hv_vt_primary_secondary_fuses', label: 'Check primary and secondary fuses', field: 'hv_vt_fuses', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'hv_vt_ir', label: 'Insulation resistance of voltage transformers >5 GΩ', field: 'hv_vt_ir', type: 'number', unit: 'GΩ', comparator: '>', threshold: 5, frequency_months: 96 },
    { id: 'hv_protection_relays', label: 'Secondary injection testing of protection relays', field: 'hv_protection_relays', type: 'check', comparator: '==', threshold: true, frequency_months: 96 }
  ],
  LV_SWITCHGEAR: [
    { id: 'lv_visu', label: 'Visuel: propreté/odeur/humidité', field: 'lv_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_arc_signs', label: 'Absence d’arc/trace', field: 'lv_arc_signs', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_relay_indications', label: 'Relay indications (flags)', field: 'lv_relay_indications', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_voltage_readings', label: 'Voltage readings', field: 'lv_voltage_readings', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_current_readings', label: 'Current readings', field: 'lv_current_readings', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_damaged_components', label: 'Damaged components e.g., displays, meters, LEDs', field: 'lv_damaged_components', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_ip2x', label: 'Ensure min IP2X protection against accidental contact with live parts', field: 'lv_ip2x', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_labels', label: 'All labels must be permanent, legible and accurate to drawing', field: 'lv_labels', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'lv_thermo', label: 'Thermography of solid insulation, bolted connections, etc.', field: 'lv_thermo', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'lv_acb_condition', label: 'Check low-voltage air circuit breakers condition', field: 'lv_acb_condition', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'lv_mccb_condition', label: 'Check moulded case circuit breakers >400A condition', field: 'lv_mccb_condition', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'lv_motor_contactors', label: 'Check motor contactors condition', field: 'lv_motor_contactors', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'lv_auto_transfer_switch', label: 'Functionally test automatic transfer switches', field: 'lv_auto_transfer_switch', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'lv_fused_switches', label: 'Check fused switches condition', field: 'lv_fused_switches', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'lv_acb_ir', label: 'Insulation resistance of ACB >100 MΩ', field: 'lv_acb_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_mccb_ir', label: 'Insulation resistance of MCCB >100 MΩ', field: 'lv_mccb_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_motor_contactors_ir', label: 'Insulation resistance of motor contactors >100 MΩ', field: 'lv_motor_contactors_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_fused_switches_ir', label: 'Insulation resistance of fused switches >100 MΩ', field: 'lv_fused_switches_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_auto_transfer_switch_ir', label: 'Insulation resistance of automatic transfer switches >100 MΩ', field: 'lv_auto_transfer_switch_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_busbars_low_res', label: 'Low resistance of busbars and cables', field: 'lv_busbars_low_res', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'lv_busbars_ir', label: 'Insulation resistance of busbars and cables >100 MΩ', field: 'lv_busbars_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'lv_protection_relays', label: 'Secondary injection testing of protection relays', field: 'lv_protection_relays', type: 'check', comparator: '==', threshold: true, frequency_months: 60 }
  ],
  TRANSFORMER_OIL: [
    { id: 'tx_visu', label: 'Fuites/corrosion/terre OK', field: 'tx_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_oil_bdv', label: 'BDV (kV) ≥ 26', field: 'tx_oil_bdv', type: 'number', unit: 'kV', comparator: '>=', threshold: 26, frequency_months: 12 },
    { id: 'tx_oil_h2o', label: 'Eau (ppm) ≤ 25', field: 'tx_oil_h2o', type: 'number', unit: 'ppm', comparator: '<=', threshold: 25, frequency_months: 12 },
    { id: 'tx_oil_pcb', label: 'PCB (ppm) < 50', field: 'tx_oil_pcb', type: 'number', unit: 'ppm', comparator: '<', threshold: 50, frequency_months: 60 },
    { id: 'tx_dga_ok', label: 'DGA OK / pas d’alarme', field: 'tx_dga_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_ir_hv', label: 'IR HV→terre (GΩ) ≥ 1', field: 'tx_ir_hv', type: 'number', unit: 'GΩ', comparator: '>=', threshold: 1, frequency_months: 96 },
    { id: 'tx_ir_lv', label: 'IR LV→terre (MΩ) ≥ 100', field: 'tx_ir_lv', type: 'number', unit: 'MΩ', comparator: '>=', threshold: 100, frequency_months: 96 },
    { id: 'tx_liq_winding_temp', label: 'Liquid & Winding Temperature Indicators', field: 'tx_liq_winding_temp', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_pressure_relief', label: 'Pressure Relief Device', field: 'tx_pressure_relief', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_gas_oil_relay', label: 'Gas and Oil Actuator Relay (Buchholz)', field: 'tx_gas_oil_relay', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_liquid_level', label: 'Liquid Level Indicator', field: 'tx_liquid_level', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_vacuum_pressure', label: 'Vacuum / Pressure Gauge', field: 'tx_vacuum_pressure', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_hv_lv_cable_boxes', label: 'HV and LV Cable Boxes', field: 'tx_hv_lv_cable_boxes', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_hv_lv_bushings', label: 'HV and LV Terminal Bushings', field: 'tx_hv_lv_bushings', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_cooling_fans_pumps', label: 'Cooling Fans and Pumps', field: 'tx_cooling_fans_pumps', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_on_load_tap_changers', label: 'On load tap changers', field: 'tx_on_load_tap_changers', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'tx_connections_fittings', label: 'Connection and fittings', field: 'tx_connections_fittings', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_off_circuit_tap_switch', label: 'Off circuit tapping switch', field: 'tx_off_circuit_tap_switch', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_earth_connection', label: 'Earth Connection Integrity', field: 'tx_earth_connection', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_low_res', label: 'Low Resistance Test', field: 'tx_low_res', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_protective_devices', label: 'Protective Devices', field: 'tx_protective_devices', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_external_paint', label: 'External paint', field: 'tx_external_paint', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'tx_pcb_analysis', label: 'PCB Analysis', field: 'tx_pcb_analysis', type: 'check', comparator: '==', threshold: true, frequency_months: 60 }
  ],
  TRANSFORMER_RESIN: [
    { id: 'txr_ventilation_protection', label: 'Ventilation and protection devices', field: 'txr_ventilation_protection', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_paintwork', label: 'Paintwork', field: 'txr_paintwork', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_cleanliness', label: 'Cleanliness', field: 'txr_cleanliness', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_insulating_distances', label: 'Insulating Distances', field: 'txr_insulating_distances', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_cables_busbars', label: 'Cables and Busbars', field: 'txr_cables_busbars', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_ingress_protection', label: 'Ingress Protection', field: 'txr_ingress_protection', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_partial_discharge', label: 'Partial Discharge', field: 'txr_partial_discharge', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_hv_lv_cable_boxes', label: 'HV and LV Cable Boxes', field: 'txr_hv_lv_cable_boxes', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_cooling_fans', label: 'Cooling Fans', field: 'txr_cooling_fans', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'txr_connections_fittings', label: 'Connection and fittings', field: 'txr_connections_fittings', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_earth_connection', label: 'Earth Connection Integrity', field: 'txr_earth_connection', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_ir', label: 'Insulation Resistance Test', field: 'txr_ir', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_low_res', label: 'Low Resistance Test', field: 'txr_low_res', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_protective_devices', label: 'Protective Devices', field: 'txr_protective_devices', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_pi', label: 'Polarisation Index ≥ 1.0', field: 'txr_pi', type: 'number', comparator: '>=', threshold: 1.0, frequency_months: 96 },
    { id: 'txr_pf', label: 'Power Factor Test', field: 'txr_pf', type: 'check', comparator: '==', threshold: true, frequency_months: 96 },
    { id: 'txr_pf_tipup', label: 'Power Factor Tip-Up Test', field: 'txr_pf_tipup', type: 'check', comparator: '==', threshold: true, frequency_months: 96 }
  ],
  PFC_HV: [
    { id: 'pfchv_mode', label: 'Mode auto correct (PF≈0.95)', field: 'pfchv_mode', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'pfchv_visual', label: 'Condos/réacteurs/câbles OK', field: 'pfchv_visual', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfchv_caps_ok', label: 'Capacitances conformes', field: 'pfchv_caps_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfchv_conn', label: 'Serrages conformes', field: 'pfchv_conn', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'pfchv_fuses_vacuum', label: 'Fuses and Vacuum Contactors', field: 'pfchv_fuses_vacuum', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'pfchv_cable_term', label: 'Cable Terminations', field: 'pfchv_cable_term', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'pfchv_connection_tightness', label: 'Connection tightness', field: 'pfchv_connection_tightness', type: 'check', comparator: '==', threshold: true, frequency_months: 36 }
  ],
  PFC_LV: [
    { id: 'pfclv_mode', label: 'Mode auto correct (PF≈0.95)', field: 'pfclv_mode', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'pfclv_visual', label: 'Condos/ventils/filtres OK', field: 'pfclv_visual', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_caps_ok', label: 'Capacitances conformes', field: 'pfclv_caps_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_conn', label: 'Serrages conformes', field: 'pfclv_conn', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'pfclv_thermo', label: 'Thermography', field: 'pfclv_thermo', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_fuses_mccbs', label: 'Fuses, MCCBs, contactors, resistors and reactors', field: 'pfclv_fuses_mccbs', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_thermal_protection', label: 'Thermal protection fitted internal to equipment', field: 'pfclv_thermal_protection', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_controller_settings', label: 'Controller settings and operational checks', field: 'pfclv_controller_settings', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'pfclv_cable_term', label: 'Cable Terminations', field: 'pfclv_cable_term', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'pfclv_connection_tightness', label: 'Connection tightness', field: 'pfclv_connection_tightness', type: 'check', comparator: '==', threshold: true, frequency_months: 36 }
  ],
  BUSDUCT: [
    { id: 'bus_visu', label: 'IP conforme / visuel OK', field: 'bus_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'bus_conn', label: 'Connexions serrées', field: 'bus_conn', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'bus_thermo', label: 'Thermography', field: 'bus_thermo', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'bus_operational_checks', label: 'Operational checks of inline mechanical components', field: 'bus_operational_checks', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'bus_low_res', label: 'Low Resistance', field: 'bus_low_res', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'bus_earthing', label: 'Earthing Resistance and Integrity checks', field: 'bus_earthing', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'bus_torque_checks', label: 'Torque checks', field: 'bus_torque_checks', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'bus_inline_mccb', label: 'Inline/tap off Moulded Case Circuit Breakers (MCCB)', field: 'bus_inline_mccb', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'bus_fusible_links', label: 'Fusible links', field: 'bus_fusible_links', type: 'check', comparator: '==', threshold: true, frequency_months: 60 }
  ],
  DISTRIBUTION_BOARD: [
    { id: 'db_visu', label: 'État / IP / pas d’échauffement', field: 'db_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'db_rcd', label: 'Essais RCD/DDR (si présents)', field: 'db_rcd', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_identification', label: 'Distribution Board Identification and Circuit Charts', field: 'db_identification', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_ingress_protection', label: 'Ingress Protection', field: 'db_ingress_protection', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_fuse_carriers_mcbs', label: 'Fuse Carriers and MCBs', field: 'db_fuse_carriers_mcbs', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_thermal_imaging', label: 'Thermal Imaging', field: 'db_thermal_imaging', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_cable_insulation', label: 'Cable Insulation', field: 'db_cable_insulation', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'db_cable_term', label: 'Cable Terminations', field: 'db_cable_term', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'db_conduit_gland', label: 'Conduit and Cable Gland Terminations', field: 'db_conduit_gland', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'db_earth_fault_loop', label: 'Earth-Fault Loop Impedance Testing', field: 'db_earth_fault_loop', type: 'check', comparator: '==', threshold: true, frequency_months: 60 }
  ],
  MOTORS_HV: [
    { id: 'mhv_visu', label: 'Palier / refroidissement', field: 'mhv_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mhv_ir', label: 'IR stator (GΩ) ≥ 1', field: 'mhv_ir', type: 'number', unit: 'GΩ', comparator: '>=', threshold: 1, frequency_months: 24 },
    { id: 'mhv_vib_ok', label: 'Vibrations OK', field: 'mhv_vib_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mhv_temp_ok', label: 'Sondes température OK', field: 'mhv_temp_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mhv_routine_visu', label: 'Routine Visual Inspection (unusual noises, vibrations, heat, etc.)', field: 'mhv_routine_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'mhv_thermal_imaging', label: 'Thermal Imaging (bearings, frame, terminal box, etc.)', field: 'mhv_thermal_imaging', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mhv_terminal_box', label: 'Motor Terminal Box (water ingress, corona, earth connections)', field: 'mhv_terminal_box', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_stator_winding_ir', label: 'Insulation resistance of stator windings', field: 'mhv_stator_winding_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 1000, frequency_months: 36 },
    { id: 'mhv_stator_winding_pi', label: 'Polarisation Index of stator windings', field: 'mhv_stator_winding_pi', type: 'number', comparator: '>=', threshold: 2, frequency_months: 36 },
    { id: 'mhv_stator_winding_dc_cond', label: 'DC conductivity of stator windings', field: 'mhv_stator_winding_dc_cond', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_stator_winding_pf', label: 'Power Factor of stator windings', field: 'mhv_stator_winding_pf', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_stator_winding_pf_tipup', label: 'Power Factor Tip Up of stator windings', field: 'mhv_stator_winding_pf_tipup', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_stator_core_inspection', label: 'Stator Core Inspection', field: 'mhv_stator_core_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_rotor_winding_ir', label: 'Insulation resistance of rotor windings', field: 'mhv_rotor_winding_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 36 },
    { id: 'mhv_rotor_winding_pi', label: 'Polarisation Index of rotor windings', field: 'mhv_rotor_winding_pi', type: 'number', comparator: '>=', threshold: 2, frequency_months: 36 },
    { id: 'mhv_rotor_winding_dc_cond', label: 'DC conductivity of rotor windings', field: 'mhv_rotor_winding_dc_cond', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_rotor_slip_rings', label: 'Inspect slip rings, brushes and brushes rigging', field: 'mhv_rotor_slip_rings', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_rotor_growler', label: 'Growler Test', field: 'mhv_rotor_growler', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_retaining_rings', label: 'Retaining rings inspection', field: 'mhv_retaining_rings', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'mhv_fan_blades', label: 'NDE of fan blades and vanes', field: 'mhv_fan_blades', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_forging', label: 'NDE of forging', field: 'mhv_forging', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_bearings_ir', label: 'Insulation resistance of bearings', field: 'mhv_bearings_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 50, frequency_months: 36 },
    { id: 'mhv_bearings_white_metal', label: 'Inspect white metal surfaces of sleeve bearings', field: 'mhv_bearings_white_metal', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_bearings_cage', label: 'Inspect cage and rolling elements of anti-friction bearings', field: 'mhv_bearings_cage', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_bearings_shaft', label: 'Inspect shaft surfaces in contact with bearings', field: 'mhv_bearings_shaft', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'mhv_heater', label: 'Check motor heater functioning', field: 'mhv_heater', type: 'check', comparator: '==', threshold: true, frequency_months: 36 }
  ],
  MOTORS_LV: [
    { id: 'mlv_visu', label: 'Palier / refroidissement', field: 'mlv_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mlv_ir', label: 'IR stator (MΩ) ≥ 1', field: 'mlv_ir', type: 'number', unit: 'MΩ', comparator: '>=', threshold: 1, frequency_months: 36 },
    { id: 'mlv_vib_ok', label: 'Vibrations OK', field: 'mlv_vib_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'mlv_visu_inspection', label: 'Visually inspect motor foundations, shaft alignment, etc.', field: 'mlv_visu_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'mlv_winding_resistance', label: 'Winding Resistance', field: 'mlv_winding_resistance', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'mlv_ir_test', label: 'Insulation Resistance', field: 'mlv_ir_test', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 },
    { id: 'mlv_dielectric_absorption', label: 'Dielectric Absorption', field: 'mlv_dielectric_absorption', type: 'number', comparator: '>=', threshold: 1.4, frequency_months: 60 },
    { id: 'mlv_starter_inspection', label: 'Electrical Tests for Motor Starters, Inverters and Cabling', field: 'mlv_starter_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'mlv_earth_fault_loop', label: 'Earth Fault Loop Impedance', field: 'mlv_earth_fault_loop', type: 'check', comparator: '==', threshold: true, frequency_months: 60 },
    { id: 'mlv_motor_circuit_ir', label: 'Motor Circuit Insulation Resistance', field: 'mlv_motor_circuit_ir', type: 'number', unit: 'MΩ', comparator: '>', threshold: 100, frequency_months: 60 }
  ],
  ATEX_EQUIPMENT: [
    { id: 'atex_mark_ok', label: 'Marquage ATEX conforme zone', field: 'atex_mark_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'atex_ip_ok', label: 'IP / câbles / glands OK', field: 'atex_ip_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'atex_corrosion_ok', label: 'Pas de corrosion', field: 'atex_corrosion_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'atex_equip_appropriate', label: 'Equipment is appropriate to the EPL / Zone', field: 'atex_equip_appropriate', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_group_correct', label: 'Equipment group is correct', field: 'atex_group_correct', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_temp_class_correct', label: 'Equipment temperature class is correct', field: 'atex_temp_class_correct', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_max_surface_temp_correct', label: 'Equipment maximum surface temperature is correct', field: 'atex_max_surface_temp_correct', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_ip_grade_appropriate', label: 'Degree of protection (IP grade) is appropriate', field: 'atex_ip_grade_appropriate', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_circuit_id_correct', label: 'Equipment circuit identification is correct', field: 'atex_circuit_id_correct', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_circuit_id_available', label: 'Equipment circuit identification is available', field: 'atex_circuit_id_available', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_enclosure_glass_ok', label: 'Enclosure, glass parts and gaskets are satisfactory', field: 'atex_enclosure_glass_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_no_unauth_mods', label: 'There are no damages or unauthorized modifications', field: 'atex_no_unauth_mods', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_no_evidence_unauth_mods', label: 'There are no evidence of unauthorized modifications', field: 'atex_no_evidence_unauth_mods', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_bolts_cable_entries', label: 'Bolts, cable entry devices are complete and tight', field: 'atex_bolts_cable_entries', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_threaded_covers', label: 'Threaded covers on enclosures are tight and secured', field: 'atex_threaded_covers', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_joint_surfaces_ok', label: 'Joint surfaces are clean and undamaged', field: 'atex_joint_surfaces_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_enclosure_gaskets_ok', label: 'Condition of enclosure gaskets is satisfactory', field: 'atex_enclosure_gaskets_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_no_ingress', label: 'No evidence of ingress of water or dust', field: 'atex_no_ingress', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_flanged_joint_gaps', label: 'Dimensions of flanged joint gaps are within limits', field: 'atex_flanged_joint_gaps', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_electrical_connections_tight', label: 'Electrical connections are tight', field: 'atex_electrical_connections_tight', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_unused_terminals_tight', label: 'Unused terminals are tightened', field: 'atex_unused_terminals_tight', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_enclosed_break_undamaged', label: 'Enclosed break and hermetically sealed devices are undamaged', field: 'atex_enclosed_break_undamaged', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_encapsulated_undamaged', label: 'Encapsulated components are undamaged', field: 'atex_encapsulated_undamaged', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_flameproof_undamaged', label: 'Flameproof components are undamaged', field: 'atex_flameproof_undamaged', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_restricted_breathing_ok', label: 'Restricted breathing enclosure is satisfactory', field: 'atex_restricted_breathing_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_test_port_functional', label: 'Test port, if fitted, is functional', field: 'atex_test_port_functional', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_breathing_ok', label: 'Breathing operation is satisfactory', field: 'atex_breathing_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_breathing_draining_ok', label: 'Breathing and draining devices are satisfactory', field: 'atex_breathing_draining_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_fluorescent_lamps_no_eol', label: 'Fluorescent lamps are not indicating EOL effects', field: 'atex_fluorescent_lamps_no_eol', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_hid_lamps_no_eol', label: 'HID lamps are not indicating EOL effects', field: 'atex_hid_lamps_no_eol', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_lamp_correct', label: 'Lamp type, rating, pin configuration and position are correct', field: 'atex_lamp_correct', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_motor_fans_clearance', label: 'Motor fans have sufficient clearance to enclosure', field: 'atex_motor_fans_clearance', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_ventilation_unimpeded', label: 'The ventilation airflow is not impeded', field: 'atex_ventilation_unimpeded', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_motor_ir_ok', label: 'Insulation resistance (IR) of the motor windings is satisfactory', field: 'atex_motor_ir_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_cable_type_appropriate', label: 'Type of cable is appropriate', field: 'atex_cable_type_appropriate', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_no_cable_damage', label: 'There is no obvious damage to cables', field: 'atex_no_cable_damage', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_sealing_satisfactory', label: 'Sealing of trunking, ducts, pipes and/or conduits is satisfactory', field: 'atex_sealing_satisfactory', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_conduit_integrity', label: 'Integrity of conduit system and interface with mixed system is maintained', field: 'atex_conduit_integrity', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_earthing_connections_ok', label: 'Earthing connections are satisfactory', field: 'atex_earthing_connections_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_fault_loop_impedance_ok', label: 'Fault loop impedance or earthing resistance is satisfactory', field: 'atex_fault_loop_impedance_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_auto_protective_devices_ok', label: 'Automatic electrical protective devices are set correctly', field: 'atex_auto_protective_devices_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_auto_devices_limits_ok', label: 'Automatic electrical protective devices operate within permitted limits', field: 'atex_auto_devices_limits_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_specific_conditions_ok', label: 'Specific conditions of use are complied with', field: 'atex_specific_conditions_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_cables_not_in_use_terminated', label: 'Cables not in use are correctly terminated', field: 'atex_cables_not_in_use_terminated', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_flameproof_obstructions_ok', label: 'Obstructions adjacent to flameproof flanged joints are in accordance with IEC 60079-14', field: 'atex_flameproof_obstructions_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_variable_voltage_ok', label: 'Variable voltage/frequency installation in accordance with documentation', field: 'atex_variable_voltage_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_temp_sensors_ok', label: 'Temperature sensors function according to manufacturer’s documents', field: 'atex_heating_temp_sensors_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_safety_cut_off_ok', label: 'Safety cut off devices function according to manufacturer’s documents', field: 'atex_heating_safety_cut_off_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_safety_sealed', label: 'The setting of the safety cut off is sealed', field: 'atex_heating_safety_sealed', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_reset_tool_only', label: 'Reset of a heating system safety cut off possible with tool only', field: 'atex_heating_reset_tool_only', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_auto_reset_not_possible', label: 'Auto-reset is not possible', field: 'atex_heating_auto_reset_not_possible', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_reset_fault_prevented', label: 'Reset of a safety cut off under fault conditions is prevented', field: 'atex_heating_reset_fault_prevented', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_heating_safety_independent', label: 'Safety cut off independent from control system', field: 'atex_heating_safety_independent', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_level_switch_ok', label: 'Level switch is installed and correctly set, if required', field: 'atex_level_switch_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_flow_switch_ok', label: 'Flow switch is installed and correctly set, if required', field: 'atex_flow_switch_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_motor_protection_te_time', label: 'Motor protection devices operate within the permitted tE or tA time limits', field: 'atex_motor_protection_te_time', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_protected_against_adverse', label: 'Equipment is adequately protected against corrosion, weather, vibration and other adverse factors', field: 'atex_protected_against_adverse', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_no_accumulation_dust', label: 'No undue accumulation of dust and dirt', field: 'atex_no_accumulation_dust', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'atex_insulation_clean_dry', label: 'Electrical insulation is clean and dry', field: 'atex_insulation_clean_dry', type: 'check', comparator: '==', threshold: true, frequency_months: 36 }
  ],
  EMERGENCY_LIGHTING: [
    { id: 'el_monthly_test', label: 'Monthly test of luminaires and signs', field: 'el_monthly_test', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'el_annual_test', label: 'Annual full rated duration test', field: 'el_annual_test', type: 'check', comparator: '==', threshold: true, frequency_months: 12 }
  ],
  UPS_SMALL: [
    { id: 'ups_s_visu', label: 'Visuel/ventilation/alarme', field: 'ups_s_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_s_batt', label: 'Batteries OK', field: 'ups_s_batt', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_s_transfer', label: 'Test transfert OK', field: 'ups_s_transfer', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_s_asset_replacement', label: 'Asset replacement', field: 'ups_s_asset_replacement', type: 'check', comparator: '==', threshold: true, frequency_months: 84 }
  ],
  UPS_LARGE: [
    { id: 'ups_l_visu', label: 'Visuel/ventilation/alarme', field: 'ups_l_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_l_batt', label: 'Capacité OK', field: 'ups_l_batt', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_l_transfer', label: 'Transfert OK', field: 'ups_l_transfer', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_l_caps', label: 'Santé condensateurs', field: 'ups_l_caps', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'ups_l_functional', label: 'Perform Functional / Operational Verification', field: 'ups_l_functional', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_l_updates', label: 'Implement Updates', field: 'ups_l_updates', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'ups_l_midlife_overhaul', label: 'UPS mid-life overhaul', field: 'ups_l_midlife_overhaul', type: 'check', comparator: '==', threshold: true, frequency_months: 72 },
    { id: 'ups_l_replacement', label: 'UPS replacement', field: 'ups_l_replacement', type: 'check', comparator: '==', threshold: true, frequency_months: 144 }
  ],
  BATTERY_SYSTEM: [
    { id: 'bat_visu', label: 'Fuites/corrosion/ventilation', field: 'bat_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'bat_cells_ok', label: 'Tensions cellules OK', field: 'bat_cells_ok', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'bat_capacity', label: 'Test capacité (si critique)', field: 'bat_capacity', type: 'check', comparator: '==', threshold: true, frequency_months: 24 },
    { id: 'bat_charger_visu', label: 'Visual inspection of Charger Unit', field: 'bat_charger_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'bat_power_capacitors', label: 'Check power capacitors for degradation', field: 'bat_power_capacitors', type: 'check', comparator: '==', threshold: true, frequency_months: 3 },
    { id: 'bat_flooded_lead_acid_monthly', label: 'Monthly check for flooded lead-acid batteries', field: 'bat_flooded_lead_acid_monthly', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'bat_flooded_lead_acid_discharge', label: 'Load discharge test for flooded lead-acid batteries', field: 'bat_flooded_lead_acid_discharge', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'bat_flooded_nicad_monthly', label: 'Monthly check for flooded Ni-Cad batteries', field: 'bat_flooded_nicad_monthly', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'bat_flooded_nicad_discharge', label: 'Load discharge test for flooded Ni-Cad batteries', field: 'bat_flooded_nicad_discharge', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'bat_sealed_lead_acid_monthly', label: 'Monthly check for sealed lead-acid batteries', field: 'bat_sealed_lead_acid_monthly', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'bat_sealed_lead_acid_discharge', label: 'Load discharge test for sealed lead-acid batteries', field: 'bat_sealed_lead_acid_discharge', type: 'check', comparator: '==', threshold: true, frequency_months: 12 }
  ],
  VSD: [
    { id: 'vsd_visu', label: 'Propreté/connexions/ventilation', field: 'vsd_visu', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_filters', label: 'Filtres OK', field: 'vsd_filters', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_log', label: 'Journal défauts analysé', field: 'vsd_log', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_params', label: 'Paramètres validés', field: 'vsd_params', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_ip_rating', label: 'Ingress Protection', field: 'vsd_ip_rating', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_ventilation', label: 'Ventilation', field: 'vsd_ventilation', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_thermal_imaging', label: 'Thermal Imaging', field: 'vsd_thermal_imaging', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'vsd_power_capacitors', label: 'Power Capacitors', field: 'vsd_power_capacitors', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'vsd_cable_term', label: 'Cable Terminations', field: 'vsd_cable_term', type: 'check', comparator: '==', threshold: true, frequency_months: 36 },
    { id: 'vsd_fans', label: 'Replace fans', field: 'vsd_fans', type: 'check', comparator: '==', threshold: true, frequency_months: 36 }
  ],
  FIRE_ALARM: [
    { id: 'fa_weekly_test', label: 'Weekly testing by the user', field: 'fa_weekly_test', type: 'check', comparator: '==', threshold: true, frequency_months: 0.23 }, // Approx 1 week
    { id: 'fa_monthly_inspection', label: 'Periodic Inspection and Test of the System', field: 'fa_monthly_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 6 },
    { id: 'fa_annual_inspection', label: 'Annual Inspection and Test of the System', field: 'fa_annual_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 12 },
    { id: 'fa_battery_monthly', label: 'Battery Inspection', field: 'fa_battery_monthly', type: 'check', comparator: '==', threshold: true, frequency_months: 1 },
    { id: 'fa_battery_annual', label: 'Battery Test/Maintenance', field: 'fa_battery_annual', type: 'check', comparator: '==', threshold: true, frequency_months: 12 }
  ]
};

// =====================================================================================
// Schema Setup
// =====================================================================================

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_equipments (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      done JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS controls_not_present (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      declared_by TEXT NOT NULL,
      declared_at TIMESTAMPTZ DEFAULT NOW(),
      last_assessment_at TIMESTAMPTZ,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,
      title TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      equipment_id INTEGER NOT NULL,
      equipment_code TEXT,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      due_date DATE NOT NULL,
      operator TEXT,
      results JSONB DEFAULT '{}'::jsonb,
      locked BOOLEAN DEFAULT false,
      attachments JSONB DEFAULT '[]'::jsonb,
      ai_risk_score NUMERIC,
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS controls_history (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      user TEXT NOT NULL,
      results JSONB NOT NULL,
      date TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
ensureSchema().catch(e => console.error('[CONTROLS SCHEMA] Init error:', e.message));

// =====================================================================================
// Adapters: Switchboards / HV / ATEX
// =====================================================================================

const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL || 'http://localhost:3003';
const HV_URL = process.env.HV_URL || 'http://localhost:3009';
const ATEX_URL = process.env.ATEX_URL || 'http://localhost:3001';

async function safeFetchJson(url, options = {}) {
  try {
    const r = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log('fetch error:', url, e.message);
    return null;
  }
}

async function loadSwitchboards(site = 'Default') {
  const data = await safeFetchJson(`${SWITCHBOARD_URL}/api/switchboard/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  const rows = data.data.map(sb => {
    const building = sb.building_code || 'B06';
    const name = sb.name || `Board-${sb.id}`;
    const code = sb.code || `SB-${sb.id}`;
    const type = sb.is_principal ? 'LV_SWITCHGEAR' : 'DISTRIBUTION_BOARD';
    return { id: sb.id, site, building, equipment_type: type, name, code };
  });
  return rows;
}

async function loadHV(site = 'Default') {
  const data = await safeFetchJson(`${HV_URL}/api/hv/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  const rows = data.data.map(hv => {
    const building = hv.building_code || '92';
    const name = hv.name || `HV-${hv.id}`;
    const code = hv.code || `HV-${hv.id}`;
    return { id: hv.id, site, building, equipment_type: 'HV_SWITCHGEAR', name, code };
  });
  return rows;
}

async function loadATEX(site = 'Default') {
  const data = await safeFetchJson(`${ATEX_URL}/api/atex/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  const rows = data.data.map(ax => {
    const building = ax.building || 'B11';
    const name = ax.component_type || `ATEX-${ax.id}`;
    const code = ax.manufacturer_ref || `ATEX-${ax.id}`;
    return { id: ax.id, site, building, equipment_type: 'ATEX_EQUIPMENT', name, code };
  });
  return rows;
}

async function syncAllExternal(site = 'Default') {
  const [sb, hv, atex] = await Promise.all([loadSwitchboards(site), loadHV(site), loadATEX(site)]);
  const incoming = [...sb, ...hv, ...atex];
  let added = 0, updated = 0;
  for (const inc of incoming) {
    if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) continue;
    const { rows: existing } = await pool.query(
      'SELECT * FROM controls_equipments WHERE site = $1 AND equipment_type = $2 AND id::text = $3',
      [inc.site, inc.equipment_type, inc.id.toString()]
    );
    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO controls_equipments (site, building, equipment_type, name, code) VALUES ($1, $2, $3, $4, $5)',
        [inc.site, inc.building, inc.equipment_type, inc.name, inc.code]
      );
      added++;
    } else {
      const prev = existing[0];
      if (prev.name !== inc.name || prev.code !== inc.code || prev.building !== inc.building) {
        await pool.query(
          'UPDATE controls_equipments SET building = $1, name = $2, code = $3 WHERE id = $4',
          [inc.building, inc.name, inc.code, prev.id]
        );
        updated++;
      }
    }
  }
  return { added, updated, total: incoming.length };
}

// =====================================================================================
// Génération des tâches (incl. NOT_PRESENT) + statut Overdue
// =====================================================================================

async function ensureOverdueFlags() {
  await pool.query("UPDATE controls_tasks SET status = 'overdue' WHERE status = 'open' AND due_date < CURRENT_DATE");
}

async function regenerateTasks(site = 'Default') {
  const { rows: equipments } = await pool.query('SELECT * FROM controls_equipments WHERE site = $1', [site]);
  const created = [];
  for (const equip of equipments) {
    const items = TSD_LIBRARY[equip.equipment_type] || [];
    let done = equip.done || {};
    for (const it of items) {
      const last = done[it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const { rows: exists } = await pool.query(
          'SELECT * FROM controls_tasks WHERE status IN (\'open\', \'overdue\') AND equipment_type = $1 AND equipment_id = $2 AND item_id = $3',
          [equip.equipment_type, equip.id, it.id]
        );
        if (exists.length === 0) {
          const due_date = todayISO(); // due now if overdue
          await pool.query(
            'INSERT INTO controls_tasks (site, building, title, equipment_type, equipment_id, equipment_code, item_id, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [site, equip.building, `${equip.name} • ${it.label}`, equip.equipment_type, equip.id, equip.code, it.id, due_date]
          );
          created.push(true
