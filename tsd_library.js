// tsd_library.js — Exhaustif (BT <1000V, ATEX, HT >1000V) + identification claire UPS/Battery
// Mapping strictement aligné avec les types utilisés par server_controls.js

export const EQUIPMENT_TYPES = [
  'LV_SWITCHBOARD',   // Tableaux BT < 1000V (TGBT, TD)
  'LV_DEVICE',        // Départs/disjoncteurs/DDR montés dans tableaux BT
  'ATEX_EQUIPMENT',   // Matériels en zones ATEX
  'HV_EQUIPMENT',     // Cellules / Switchgear HT >1000V (y.c. TF, disjoncteurs, relais, SF6…)
  'UPS',              // UPS (marqué non couvert par défaut)
  'BATTERY_SYSTEM'    // Batteries / racks (marqué non couvert par défaut)
];

// Utilitaires courants
const YES = true;
const NO  = false;

// Pour UPS/BATTERY : indicateur pour le backend (si false => classer en not_present)
export const TSD_FLAGS = {
  UPS: { enabled: false, note: 'Non couvert TSD actuel. À construire ultérieurement.' },
  BATTERY_SYSTEM: { enabled: false, note: 'Non couvert TSD actuel. À construire ultérieurement.' }
};

export const TSD_LIBRARY = {

  // =====================================================================
  // LV — SWITCHBOARD (< 1000V) : TGBT, tableaux divisionnaires, busbar
  // =====================================================================
  LV_SWITCHBOARD: [
    {
      id: 'lv_room_clean_dry',
      label: 'Local propre, sec, ventilé',
      field: 'lv_room_clean_dry',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 3,
      procedure_md: 'Inspection visuelle du local (poussière, humidité, fuites, ventilation). Vérifier que nulle obstruction gêne la dissipation thermique.',
      hazards_md: 'Choc électrique, arc en cas de pollution/condensation.',
      ppe_md: 'Gants isolants cat. adaptée, lunettes.',
      tools_md: 'Lampe, caméra thermique (optionnelle).'
    },
    {
      id: 'lv_covers_doors_labels',
      label: 'Capots/portes/serrures/plaques signalétique',
      field: 'lv_panels_integrity',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 6,
      procedure_md: 'Vérifier l’intégrité, la fixation, les verrous/clefs et la lisibilité des étiquettes/cadenassage.',
      hazards_md: 'Contact direct si capot manquant, coupure intempestive.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Tournevis/clé isolée.'
    },
    {
      id: 'lv_thermography',
      label: 'Thermographie sous charge',
      field: 'lv_ir_max_delta',
      type: 'number',
      unit: '°C',
      comparator: '<=',
      threshold: 25,
      frequency_months: 12,
      procedure_md: 'Effectuer une thermographie en charge nominale. Tolérer ΔT ≤ 25°C entre connexions homogènes. Au-delà, investiguer serrage/oxydation.',
      hazards_md: 'Brûlure, exposition arc si enlèvement capots.',
      ppe_md: 'Visière/écran facial, gants ignifugés selon risque.',
      tools_md: 'Caméra IR étalonnée.'
    },
    {
      id: 'lv_torque_check',
      label: 'Re-serrage connexions principales',
      field: 'lv_torque_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 24,
      procedure_md: 'Contrôle couple sur jeux de barres/borniers selon couples constructeur. Si couple non disponible, appliquer référentiel interne et consigner.',
      hazards_md: 'Arc à l’ouverture, serrage sur pièces sous tension interdit.',
      ppe_md: 'Gants isolants, lunettes.',
      tools_md: 'Clé dynamométrique isolée.'
    },
    {
      id: 'lv_insulation_resistance',
      label: 'Mesure de résistance d’isolement tableau',
      field: 'lv_ir_value',
      type: 'number',
      unit: 'MΩ',
      comparator: '>=',
      threshold: 1,
      frequency_months: 36,
      procedure_md: 'Mesurer l’isolement phase/terre et phase/phase selon procédure. Seuil minimal 1 MΩ (ou conforme note constructeur/site).',
      hazards_md: 'Injection de tension d’essai, déconnexion préalable requise.',
      ppe_md: 'Gants isolants, lunettes.',
      tools_md: 'Mégohmmètre.'
    },
    {
      id: 'lv_rcd_test',
      label: 'Test déclenchement DDR/RCD (bouton Test ou injecteur)',
      field: 'lv_rcd_trip',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Actionner bouton TEST ou injecter IΔn pour vérifier déclenchement dans le temps spécifié.',
      hazards_md: 'Coupure de circuits sensibles.',
      ppe_md: 'Aucun spécifique (prévenir utilisateurs).',
      tools_md: 'Injecteur DDR (si disponible).'
    },
    {
      id: 'lv_earthing_continuity',
      label: 'Continuité de la liaison équipotentielle',
      field: 'lv_pe_continuity',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Vérifier continuité PE entre carcasses/portes/rails et barres PE.',
      hazards_md: 'Risque choc si absence de PE.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Ohmmètre faible courant.'
    }
  ],

  // =====================================================================
  // LV — DEVICES (< 1000V) : Départs, disjoncteurs, sectionneurs, VSD, etc.
  // =====================================================================
  LV_DEVICE: [
    {
      id: 'dev_visual_mechanical',
      label: 'État visuel & mécanique (poignées, indicateurs)',
      field: 'dev_visual_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Vérifier indicateurs (ouvert/fermé), verrouillage, position, étiquetage, câblage apparent.',
      hazards_md: 'Contact direct si capot/vis manquants.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Tournevis isolé.'
    },
    {
      id: 'dev_functional_test',
      label: 'Essai fonctionnel (déclencheur/disjoncteur) hors charge',
      field: 'dev_trip_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 24,
      procedure_md: 'Tester le déclenchement mécanique (si possible). Ne pas endommager sélectivité/production. Consigner temps/observations.',
      hazards_md: 'Coupure inattendue si mal isolé du réseau.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Injecteur secondaire (si relais), chronomètre.'
    },
    {
      id: 'dev_thermography',
      label: 'Thermographie sur bornes du départ',
      field: 'dev_ir_max_delta',
      type: 'number',
      unit: '°C',
      comparator: '<=',
      threshold: 20,
      frequency_months: 12,
      procedure_md: 'Caméra IR sur bornes du départ en charge. ΔT ≤ 20°C. Sinon, contrôler serrage/oxydation.',
      hazards_md: 'Brûlure/arc si capots retirés sous charge.',
      ppe_md: 'Visière, gants ignifugés si risque.',
      tools_md: 'Caméra IR.'
    },
    {
      id: 'dev_rcd',
      label: 'Si DDR intégré : test de déclenchement',
      field: 'dev_rcd_trip',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Appuyer test ou injecter IΔn, vérifier déclenchement et temps.',
      hazards_md: 'Perte alimentation circuits aval.',
      ppe_md: 'Aucun spécifique.',
      tools_md: 'Injecteur DDR.'
    }
  ],

  // =====================================================================
  // ATEX — ZONES EXPLOSIVES (Ex d/e/i/n/t) : Matériels marqués Ex
  // =====================================================================
  ATEX_EQUIPMENT: [
    {
      id: 'atex_visual_external',
      label: 'Inspection visuelle externe (Cat. 1/2/3) — rapproché',
      field: 'atex_ext_visual_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 6,
      procedure_md: 'Contrôler enveloppes, presse-étoupes, garnitures, corrosion, chocs, marquage CE/Ex lisible, IP adapté à la zone.',
      hazards_md: 'Risque d’explosion (empêcher toute source d’ignition).',
      ppe_md: 'Chaussures antistatiques, tenue antistatique, ESD si requis.',
      tools_md: 'Lampe ATEX, clé dynamométrique ATEX.'
    },
    {
      id: 'atex_detailed_internal',
      label: 'Inspection détaillée (ouverture) selon mode de protection',
      field: 'atex_detailed_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Ouvrir si autorisé (Ex e/d). Vérifier jeux d’air, joints, surfaces de contact Ex d, serrage bornes, continuité PE.',
      hazards_md: 'Perte de confinement Ex d, risque inflammation.',
      ppe_md: 'Gants, lunettes, ESD si électronique.',
      tools_md: 'Clé dynamométrique ATEX, multimètre, jauges.'
    },
    {
      id: 'atex_bonding_earthing',
      label: 'Liaisons équipotentielles & terre',
      field: 'atex_pe_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Vérifier continuité PE, pontages, ponts de terre sur presse-étoupes métalliques, serrage.',
      hazards_md: 'Charge électrostatique non évacuée.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Ohmmètre faible courant.'
    }
  ],

  // =====================================================================
  // HV — > 1000V : Switchgear HT, Transformateurs, Disjoncteurs, Relais, SF6
  // =====================================================================
  HV_EQUIPMENT: [
    {
      id: 'hv_room_clean_dry',
      label: 'Local HT propre, sec, verrouillé',
      field: 'hv_room_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 3,
      procedure_md: 'Inspection du local HT : propreté, absence d’humidité, verrouillage, absence d’intrusions.',
      hazards_md: 'Arc HT (danger mortel), claquages.',
      ppe_md: 'Casque, visière, gants isolants HT, vêtements ignifugés.',
      tools_md: 'Lampe, caméra IR (option).'
    },
    {
      id: 'hv_cb_timing',
      label: 'Essai temporisation disjoncteur HT',
      field: 'hv_cb_time_ms',
      type: 'number',
      unit: 'ms',
      comparator: '<=',
      threshold: 80,
      frequency_months: 24,
      procedure_md: 'Mesure des temps d’ouverture/fermeture sous injecteur secondaire selon constructeur. Comparer au référentiel.',
      hazards_md: 'Mauvaise manœuvre peut endommager l’appareil.',
      ppe_md: 'Gants isolants HT, lunettes.',
      tools_md: 'Injecteur secondaire, chronomètre/temporographe.'
    },
    {
      id: 'hv_protection_relay_test',
      label: 'Test relais de protection (secondaire)',
      field: 'hv_relay_trip_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Injection secondaire pour vérifier tripping/paramètres, en respectant sélectivité & consignation.',
      hazards_md: 'Déclenchement intempestif si mauvais câblage.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Injecteur secondaire, PC logiciel si numérique.'
    },
    {
      id: 'hv_sf6_density',
      label: 'Contrôle densité SF₆',
      field: 'hv_sf6_density_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Relever densité/pression SF₆ vs température. En cas d’écart, consigner et programmer maintenance.',
      hazards_md: 'Fuite de gaz, risque environnemental.',
      ppe_md: 'Gants, lunettes.',
      tools_md: 'Densimètre/lecteur fabricant.'
    },
    {
      id: 'tf_oil_dga',
      label: 'Transformateur — DGA (analyse gaz dissous) / rigidité diélectrique',
      field: 'tf_oil_dga_ok',
      type: 'check',
      comparator: '==',
      threshold: YES,
      frequency_months: 12,
      procedure_md: 'Prélèvement huile : DGA, rigidité diélectrique, BF/BG, eau/ppm. Comparer aux seuils alerte.',
      hazards_md: 'Brûlure huile chaude, pollution.',
      ppe_md: 'Gants, lunettes, combinaison anti-huile.',
      tools_md: 'Kit prélèvement, flacons labo.'
    },
    {
      id: 'tf_thermography',
      label: 'Transformateur — thermographie connexions/évents',
      field: 'tf_ir_delta',
      type: 'number',
      unit: '°C',
      comparator: '<=',
      threshold: 25,
      frequency_months: 12,
      procedure_md: 'Thermographie sur bornes BT/HT, radiateurs, connexions ; ΔT ≤ 25°C.',
      hazards_md: 'Brûlure/arc.',
      ppe_md: 'Visière/écran, gants ignifugés.',
      tools_md: 'Caméra IR.'
    },
    {
      id: 'tf_tan_delta',
      label: 'Transformateur — tangente delta/isolement',
      field: 'tf_tandelta',
      type: 'number',
      unit: '%',
      comparator: '<=',
      threshold: 1.0,
      frequency_months: 36,
      procedure_md: 'Mesure tan δ selon norme/constructeur, comparer aux historiques.',
      hazards_md: 'Tension d’essai élevée.',
      ppe_md: 'Gants isolants HT.',
      tools_md: 'Pont de mesure tan δ.'
    }
  ],

  // =====================================================================
  // UPS (non couvert TSD — volontairement marqué pour not_present)
  // =====================================================================
  UPS: [
    {
      id: 'ups_placeholder',
      label: 'UPS — non couvert (à construire)',
      field: 'ups_placeholder',
      type: 'check',
      comparator: '==',
      threshold: NO,
      frequency_months: 12,
      procedure_md: 'À définir ultérieurement.',
      hazards_md: '—',
      ppe_md: '—',
      tools_md: '—'
    }
  ],

  // =====================================================================
  // BATTERY SYSTEM (non couvert TSD — volontairement marqué pour not_present)
  // =====================================================================
  BATTERY_SYSTEM: [
    {
      id: 'bat_placeholder',
      label: 'Batteries — non couvert (à construire)',
      field: 'bat_placeholder',
      type: 'check',
      comparator: '==',
      threshold: NO,
      frequency_months: 12,
      procedure_md: 'À définir ultérieurement.',
      hazards_md: '—',
      ppe_md: '—',
      tools_md: '—'
    }
  ]
};

// Normalisation : s’assurer que chaque item a bien ses champs de base
Object.keys(TSD_LIBRARY).forEach(type => {
  TSD_LIBRARY[type].forEach(item => {
    item.type = item.type || 'check';
    item.comparator = item.comparator || '==';
    item.threshold = (item.threshold === undefined) ? YES : item.threshold;
    item.frequency_months = item.frequency_months || 12;
    item.procedure_md = item.procedure_md || 'Procédure standard selon fabricant et consignes site.';
    item.hazards_md = item.hazards_md || 'Risque électrique standard. Respecter consignations.';
    item.ppe_md = item.ppe_md || 'Gants isolants, lunettes.';
    item.tools_md = item.tools_md || 'Outils standard de maintenance.';
  });
});
