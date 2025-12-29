/**
 * src/lib/electrical-calculations.js
 * Automatic Electrical Calculations Library
 * Standards: IEC 60909, IEEE 1584-2018, IEC 60947-2, NFPA 70E
 */

// Safe toFixed helper - handles strings, null, undefined, NaN
const safeToFixed = (value, decimals = 2) => {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return '-';
  return num.toFixed(decimals);
};

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD PARAMETERS (Industry defaults)
// ═══════════════════════════════════════════════════════════════════════════

export const STANDARD_PARAMS = {
  // Cable resistivity (Ω·mm²/m at 20°C)
  cable: {
    copper: { resistivity: 0.0178, tempCoeff: 0.00393 },
    aluminum: { resistivity: 0.0287, tempCoeff: 0.00403 },
  },

  // Standard cable lengths by installation type (meters)
  cableLengths: {
    same_room: 5,
    same_floor: 15,
    adjacent_floor: 25,
    different_building: 50,
    default: 20,
  },

  // Standard cable sections by current rating (mm²)
  cableSections: {
    16: 1.5, 20: 2.5, 25: 4, 32: 6, 40: 10, 50: 16, 63: 25,
    80: 35, 100: 50, 125: 70, 160: 95, 200: 120, 250: 150,
    315: 185, 400: 240, 500: 300, 630: 400, 800: 500, 1000: 630,
  },

  // Transformer standard impedances (Ukr%)
  transformers: {
    100: 4, 160: 4, 250: 4, 315: 4, 400: 4, 500: 4,
    630: 6, 800: 6, 1000: 6, 1250: 6, 1600: 6,
    2000: 6, 2500: 6, 3150: 6.5,
  },

  // Arc flash electrode configurations
  electrodeConfigs: {
    'Panel': 'VCB',      // Vertical conductors in box
    'MCC': 'VCBB',       // Vertical conductors in box with barrier
    'Switchgear': 'HCB', // Horizontal conductors in box
    'Open': 'VOA',       // Vertical open air
    'Cable': 'HOA',      // Horizontal open air
  },

  // Electrode gaps by voltage (mm)
  electrodeGaps: {
    230: 25, 400: 32, 480: 32, 600: 32, 4160: 102, 13800: 153,
  },

  // Working distances by equipment type (mm)
  workingDistances: {
    'Panel': 455,
    'MCC': 455,
    'Switchgear': 610,
    'Cable': 455,
    'Transformer': 455,
  },

  // Standard trip times by breaker type (seconds)
  tripTimes: {
    'MCB': 0.02,
    'MCCB': 0.05,
    'ACB': 0.08,
    'Fuse': 0.01,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// IEC 60909 - FAULT LEVEL CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate short-circuit current per IEC 60909-0
 */
export function calculateFaultLevel(params) {
  const {
    voltage_v = 400,
    source_fault_ka = 50,      // Upstream fault level (kA) - from utility or transformer
    cable_length_m = 20,
    cable_section_mm2 = 95,
    cable_material = 'copper',
    transformer_kva = null,
    transformer_ukr = null,
    temperature_c = 70,        // Operating temperature
  } = params;

  const c = 1.0; // Voltage factor for LV
  const Un = voltage_v;

  // Source impedance (from upstream fault level)
  const Zs = (c * Un) / (Math.sqrt(3) * source_fault_ka * 1000);

  // Cable impedance
  const material = STANDARD_PARAMS.cable[cable_material] || STANDARD_PARAMS.cable.copper;
  const rho20 = material.resistivity;
  const alpha = material.tempCoeff;
  const rhoT = rho20 * (1 + alpha * (temperature_c - 20));

  const Rc = (rhoT * cable_length_m * 2) / cable_section_mm2; // Go + return
  const Xc = 0.08 * cable_length_m / 1000; // ~0.08 mΩ/m for typical cable

  // Transformer impedance (if specified)
  let Zt = 0;
  if (transformer_kva && transformer_ukr) {
    Zt = (transformer_ukr / 100) * (Un * Un) / (transformer_kva * 1000);
  }

  // Total impedance
  const Rtotal = Zs * 0.3 + Rc; // Assume R/X = 0.3 for source
  const Xtotal = Zs * 0.95 + Xc + Zt * 0.95;
  const Ztotal = Math.sqrt(Rtotal * Rtotal + Xtotal * Xtotal);

  // Short-circuit currents
  const Ik_3ph = (c * Un) / (Math.sqrt(3) * Ztotal); // 3-phase fault
  const Ik_1ph = (c * Un) / (2 * Ztotal);             // 1-phase fault (approx)

  // R/X ratio and kappa factor
  const RX_ratio = Rtotal / Xtotal;
  const kappa = 1.02 + 0.98 * Math.exp(-3 * RX_ratio);

  // Peak current
  const Ip = kappa * Math.sqrt(2) * Ik_3ph;

  // Breaking current (at 50ms for typical breakers)
  const mu = 0.84 + 0.26 * Math.exp(-0.26 * RX_ratio);
  const Ib = mu * Ik_3ph;

  // Thermal equivalent (1s)
  const m = 0.02; // Typical for LV
  const n = 0.97;
  const Ith = Ik_3ph * Math.sqrt(m + n);

  return {
    Ik_kA: Ik_3ph / 1000,
    Ik_1ph_kA: Ik_1ph / 1000,
    Ip_kA: Ip / 1000,
    Ib_kA: Ib / 1000,
    Ith_kA: Ith / 1000,
    RX_ratio: Number(RX_ratio.toFixed(3)),
    kappa: Number(kappa.toFixed(3)),
    Ztotal_mohm: Ztotal * 1000,
    voltage_v,
    standard: 'IEC 60909-0',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// IEEE 1584-2018 - ARC FLASH CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

const ELECTRODE_COEFFICIENTS = {
  VCB:  { k1: -0.04287, k2: 1.035, k3: -0.083, k4: 0, k5: 0.0016, k6: 1.035, k7: -0.0631, k8: 0, k9: 0, k10: 0 },
  VCBB: { k1: -0.05422, k2: 1.140, k3: -0.1, k4: 0, k5: 0.00135, k6: 1.14, k7: -0.076, k8: 0, k9: 0, k10: 0 },
  HCB:  { k1: -0.03568, k2: 0.959, k3: -0.078, k4: 0, k5: 0.00259, k6: 0.959, k7: -0.05, k8: 0, k9: 0, k10: 0 },
  VOA:  { k1: -0.02457, k2: 1.013, k3: -0.072, k4: 0, k5: 0.00105, k6: 1.013, k7: -0.055, k8: 0, k9: 0, k10: 0 },
  HOA:  { k1: -0.01619, k2: 0.903, k3: -0.065, k4: 0, k5: 0.00167, k6: 0.903, k7: -0.035, k8: 0, k9: 0, k10: 0 },
};

const PPE_CATEGORIES = [
  { level: 0, max: 1.2, name: 'Aucun PPE requis', color: 'green' },
  { level: 1, max: 4, name: 'PPE Cat. 1', color: 'blue' },
  { level: 2, max: 8, name: 'PPE Cat. 2', color: 'yellow' },
  { level: 3, max: 25, name: 'PPE Cat. 3', color: 'orange' },
  { level: 4, max: 40, name: 'PPE Cat. 4', color: 'red' },
  { level: 5, max: Infinity, name: 'DANGER EXTRÊME', color: 'darkred' },
];

/**
 * Calculate arc flash incident energy per IEEE 1584-2018
 */
export function calculateArcFlash(params) {
  const {
    voltage_v = 400,
    bolted_fault_ka = 25,
    arc_duration_s = 0.1,
    working_distance_mm = 455,
    electrode_gap_mm = 32,
    electrode_config = 'VCB',
    enclosure_width_mm = 508,
    enclosure_height_mm = 508,
    enclosure_depth_mm = 203,
  } = params;

  const Voc = voltage_v / 1000; // Convert to kV
  const Ibf = bolted_fault_ka;
  const G = electrode_gap_mm;
  const D = working_distance_mm;
  const t = arc_duration_s;
  const W = enclosure_width_mm;
  const H = enclosure_height_mm;
  const De = enclosure_depth_mm;

  const coef = ELECTRODE_COEFFICIENTS[electrode_config] || ELECTRODE_COEFFICIENTS.VCB;

  // Arcing current (simplified IEEE 1584-2018)
  const lgIarc = coef.k1 + coef.k2 * Math.log10(Ibf) + coef.k3 * Math.log10(G);
  const Iarc = Math.pow(10, lgIarc);

  // Incident energy at working distance
  const lgE = coef.k5 + coef.k6 * Math.log10(Iarc) + coef.k7 * Math.log10(D);
  const E_normalized = Math.pow(10, lgE); // J/cm² at 0.2s

  // Adjust for actual arc duration
  const E = E_normalized * (t / 0.2);

  // Arc flash boundary (where E = 1.2 cal/cm²)
  const AFB = D * Math.pow(E / 1.2, 0.5);

  // PPE category
  const E_cal = E / 4.184; // Convert J/cm² to cal/cm²
  const ppe = PPE_CATEGORIES.find(p => E_cal <= p.max) || PPE_CATEGORIES[5];

  return {
    incident_energy_cal: Number(E_cal.toFixed(2)),
    incident_energy_j: Number(E.toFixed(2)),
    arc_current_ka: Number(Iarc.toFixed(2)),
    arc_flash_boundary_mm: Number(AFB.toFixed(0)),
    ppe_category: ppe.level,
    ppe_name: ppe.name,
    ppe_color: ppe.color,
    working_distance_mm,
    arc_duration_ms: arc_duration_s * 1000,
    voltage_v,
    bolted_fault_ka,
    standard: 'IEEE 1584-2018',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// IEC 60947-2 - SELECTIVITY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate trip curve for a circuit breaker
 */
export function generateTripCurve(device) {
  const {
    in_amps = 100,
    Ir = 1.0,
    Tr = 10,
    Isd = 8,
    Tsd = 0.1,
    Ii = 10,
    curve = 'C',
    isMCCB = true,
  } = device;

  const In = in_amps;
  const points = [];
  const Ir_A = Ir * In;
  const Isd_A = Isd * Ir * In;
  const Ii_A = Ii * In;

  for (let mult = 0.5; mult <= 100; mult *= 1.1) {
    const I = mult * In;
    let t = null;

    if (isMCCB || In > 63) {
      if (I >= Ii_A) t = 0.01;
      else if (I >= Isd_A) t = Tsd;
      else if (I >= Ir_A) {
        t = Tr * Math.pow(Ir_A / I, 2);
        t = Math.max(0.01, Math.min(t, 10000));
      }
    } else {
      // MCB curve
      const curves = { B: 5, C: 10, D: 14, K: 14, Z: 3 };
      const mag = (curves[curve] || 10) * In;
      if (I >= mag) t = 0.01;
      else if (I >= 1.13 * In) {
        t = 3600 * Math.pow(1.45 * In / I, 2);
        t = Math.min(t, 10000);
      }
    }

    if (t !== null) points.push({ current: I, time: t });
  }

  return points;
}

/**
 * Check selectivity between upstream and downstream breakers
 */
export function checkSelectivity(upstream, downstream, faultCurrents = null) {
  const upCurve = generateTripCurve(upstream);
  const downCurve = generateTripCurve(downstream);

  // Default fault currents
  if (!faultCurrents) {
    const maxFault = Math.max(upstream.in_amps, downstream.in_amps) * 50;
    faultCurrents = [];
    for (let i = downstream.in_amps; i <= maxFault; i *= 1.5) {
      faultCurrents.push(i);
    }
  }

  const results = [];
  let isSelective = true;
  let limitCurrent = null;

  for (const I of faultCurrents) {
    const tUp = upCurve.find(p => p.current >= I)?.time;
    const tDown = downCurve.find(p => p.current >= I)?.time;

    let status = 'no_trip';
    let margin = null;

    if (tUp && tDown) {
      margin = ((tUp - tDown) / tDown) * 100;
      if (tDown < tUp * 0.8) {
        status = 'selective';
      } else if (tDown < tUp) {
        status = 'partial';
        if (!limitCurrent) limitCurrent = I;
      } else {
        status = 'non_selective';
        isSelective = false;
        if (!limitCurrent) limitCurrent = I;
      }
    } else if (tDown && !tUp) {
      status = 'selective';
    }

    results.push({ current: I, tUp, tDown, margin, status });
  }

  return {
    isSelective,
    isPartiallySelective: !isSelective && limitCurrent !== null,
    limitCurrent,
    results,
    upstream: { name: upstream.name, in_amps: upstream.in_amps },
    downstream: { name: downstream.name, in_amps: downstream.in_amps },
    standard: 'IEC 60947-2',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATIC CASCADE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-determine cable section from current rating
 */
export function getCableSection(currentAmps) {
  const sections = Object.entries(STANDARD_PARAMS.cableSections);
  for (const [rating, section] of sections) {
    if (currentAmps <= Number(rating)) return section;
  }
  return 630; // Max
}

/**
 * Auto-determine cable length
 */
export function getCableLength(sourceLocation, destLocation) {
  if (sourceLocation === destLocation) return STANDARD_PARAMS.cableLengths.same_room;
  // Could be enhanced with building/floor parsing
  return STANDARD_PARAMS.cableLengths.default;
}

/**
 * Get trip time from device type
 */
export function getTripTime(device) {
  const settings = device.settings || {};
  if (settings.trip_time_s) return settings.trip_time_s;

  const type = (device.device_type || '').toUpperCase();
  if (type.includes('MCB')) return STANDARD_PARAMS.tripTimes.MCB;
  if (type.includes('MCCB')) return STANDARD_PARAMS.tripTimes.MCCB;
  if (type.includes('ACB')) return STANDARD_PARAMS.tripTimes.ACB;
  if (type.includes('FUSE')) return STANDARD_PARAMS.tripTimes.Fuse;

  // Estimate from Icu
  if (device.icu_ka >= 50) return 0.08; // ACB range
  if (device.icu_ka >= 25) return 0.05; // MCCB range
  return 0.02; // MCB range
}

/**
 * Get electrode config from equipment type
 */
export function getElectrodeConfig(equipmentType) {
  return STANDARD_PARAMS.electrodeConfigs[equipmentType] || 'VCB';
}

/**
 * Run complete cascade analysis for a switchboard and its devices
 */
export function runCascadeAnalysis(switchboard, devices, upstreamFaultKa = 50, transformerKva = null) {
  const results = {
    switchboard: {
      id: switchboard.id,
      name: switchboard.name,
      code: switchboard.code,
    },
    faultLevel: null,
    arcFlash: null,
    selectivity: [],
    deviceAnalysis: [],
    warnings: [],
    timestamp: new Date().toISOString(),
  };

  // Get main incoming device
  const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];

  if (!mainDevice) {
    results.warnings.push('Aucun disjoncteur principal trouvé');
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. FAULT LEVEL at switchboard incoming
  // ─────────────────────────────────────────────────────────────────────────

  const voltage = switchboard.voltage_v || mainDevice.voltage_v || 400;
  const cableSection = mainDevice.cable_section_mm2 || getCableSection(mainDevice.in_amps || 100);
  const cableLength = mainDevice.cable_length_m || STANDARD_PARAMS.cableLengths.default;

  const flaParams = {
    voltage_v: voltage,
    source_fault_ka: upstreamFaultKa,
    cable_length_m: cableLength,
    cable_section_mm2: cableSection,
    cable_material: mainDevice.cable_material || 'copper',
    transformer_kva: transformerKva || null,
    transformer_ukr: transformerKva ? (STANDARD_PARAMS.transformers[transformerKva] || 6) : null,
  };

  results.faultLevel = calculateFaultLevel(flaParams);

  // Check if main breaker can handle fault
  if (mainDevice.icu_ka && results.faultLevel.Ik_kA > mainDevice.icu_ka) {
    results.warnings.push(`DANGER: Ik" (${safeToFixed(results.faultLevel.Ik_kA, 1)} kA) > Icu du disjoncteur principal (${mainDevice.icu_ka} kA)`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. ARC FLASH at switchboard
  // ─────────────────────────────────────────────────────────────────────────

  const tripTime = getTripTime(mainDevice);
  const electrodeConfig = getElectrodeConfig(switchboard.type || 'Panel');

  const afParams = {
    voltage_v: voltage,
    bolted_fault_ka: results.faultLevel.Ik_kA,
    arc_duration_s: tripTime,
    working_distance_mm: STANDARD_PARAMS.workingDistances[switchboard.type] || 455,
    electrode_gap_mm: STANDARD_PARAMS.electrodeGaps[voltage] || 32,
    electrode_config: electrodeConfig,
    enclosure_width_mm: 508,
    enclosure_height_mm: 508,
    enclosure_depth_mm: 203,
  };

  results.arcFlash = calculateArcFlash(afParams);

  if (results.arcFlash.ppe_category >= 4) {
    results.warnings.push(`ATTENTION: Énergie incidente élevée (${results.arcFlash.incident_energy_cal} cal/cm²) - PPE Cat. ${results.arcFlash.ppe_category} requis`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. SELECTIVITY between all parent-child pairs
  // ─────────────────────────────────────────────────────────────────────────

  // Build device hierarchy
  const deviceMap = new Map(devices.map(d => [d.id, d]));

  for (const device of devices) {
    // Find upstream device (parent or main)
    let upstream = null;
    if (device.parent_id) {
      upstream = deviceMap.get(device.parent_id);
    } else if (!device.is_main_incoming && mainDevice.id !== device.id) {
      upstream = mainDevice;
    }

    if (upstream) {
      const upSettings = upstream.settings || {};
      const downSettings = device.settings || {};

      const upDevice = {
        name: upstream.name || `${upstream.manufacturer || ''} ${upstream.reference || ''}`.trim(),
        in_amps: upstream.in_amps || 100,
        Ir: upSettings.Ir || 1.0,
        Tr: upSettings.Tr || 15,
        Isd: upSettings.Isd || 8,
        Tsd: upSettings.Tsd || 0.2,
        Ii: upSettings.Ii || 12,
        isMCCB: (upstream.in_amps || 0) > 63,
      };

      const downDevice = {
        name: device.name || `${device.manufacturer || ''} ${device.reference || ''}`.trim(),
        in_amps: device.in_amps || 100,
        Ir: downSettings.Ir || 1.0,
        Tr: downSettings.Tr || 10,
        Isd: downSettings.Isd || 8,
        Tsd: downSettings.Tsd || 0.1,
        Ii: downSettings.Ii || 10,
        isMCCB: (device.in_amps || 0) > 63,
      };

      const selectivityResult = checkSelectivity(upDevice, downDevice);
      results.selectivity.push(selectivityResult);

      if (!selectivityResult.isSelective) {
        results.warnings.push(`Sélectivité non assurée entre ${upDevice.name} et ${downDevice.name} (limite: ${safeToFixed(selectivityResult.limitCurrent, 0)} A)`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Per-device analysis (FLA at each feeder)
    // ─────────────────────────────────────────────────────────────────────────

    const deviceCableLength = device.cable_length_m || STANDARD_PARAMS.cableLengths.same_floor;
    const deviceCableSection = device.cable_section_mm2 || getCableSection(device.in_amps || 100);

    const deviceFla = calculateFaultLevel({
      voltage_v: voltage,
      source_fault_ka: results.faultLevel.Ik_kA, // Upstream is switchboard fault level
      cable_length_m: deviceCableLength,
      cable_section_mm2: deviceCableSection,
      cable_material: device.cable_material || 'copper',
    });

    const deviceAnalysis = {
      device: {
        id: device.id,
        name: device.name,
        reference: device.reference,
        manufacturer: device.manufacturer,
        in_amps: device.in_amps,
        icu_ka: device.icu_ka,
      },
      faultLevel: deviceFla,
      icuOk: !device.icu_ka || deviceFla.Ik_kA <= device.icu_ka,
    };

    if (!deviceAnalysis.icuOk) {
      results.warnings.push(`${device.name}: Ik" (${safeToFixed(deviceFla.Ik_kA, 1)} kA) > Icu (${device.icu_ka} kA)`);
    }

    results.deviceAnalysis.push(deviceAnalysis);
  }

  return results;
}

/**
 * Run analysis for entire network (multiple switchboards)
 */
export function runNetworkAnalysis(switchboards, devicesByBoard, sourceParams = {}) {
  const {
    utility_fault_ka = 50,
    main_transformer_kva = null,
  } = sourceParams;

  const networkResults = {
    timestamp: new Date().toISOString(),
    source: { utility_fault_ka, main_transformer_kva },
    switchboards: [],
    totalWarnings: [],
  };

  // Sort switchboards by hierarchy (main first, then downstream)
  const sortedBoards = [...switchboards].sort((a, b) => {
    if (a.is_principal && !b.is_principal) return -1;
    if (!a.is_principal && b.is_principal) return 1;
    return 0;
  });

  const faultLevelMap = new Map(); // Store fault levels for cascade

  for (const board of sortedBoards) {
    const devices = devicesByBoard[board.id] || [];

    // Determine upstream fault level
    let upstreamFaultKa = utility_fault_ka;

    // Check if this board is fed from another board
    for (const [boardId, boardDevices] of Object.entries(devicesByBoard)) {
      const feedingDevice = boardDevices.find(d => d.downstream_switchboard_id === board.id);
      if (feedingDevice && faultLevelMap.has(Number(boardId))) {
        // Use the fault level at the feeding device
        const upstreamAnalysis = faultLevelMap.get(Number(boardId));
        upstreamFaultKa = upstreamAnalysis.faultLevel?.Ik_kA || upstreamFaultKa;
        break;
      }
    }

    const analysis = runCascadeAnalysis(
      board,
      devices,
      upstreamFaultKa,
      board.is_principal ? main_transformer_kva : null
    );

    networkResults.switchboards.push(analysis);
    faultLevelMap.set(board.id, analysis);
    networkResults.totalWarnings.push(...analysis.warnings);
  }

  return networkResults;
}

export default {
  STANDARD_PARAMS,
  calculateFaultLevel,
  calculateArcFlash,
  generateTripCurve,
  checkSelectivity,
  runCascadeAnalysis,
  runNetworkAnalysis,
  getCableSection,
  getCableLength,
  getTripTime,
};
