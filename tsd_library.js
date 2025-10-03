// tsd_library.js — Bibliothèque TSD exhaustive

export const EQUIPMENT_TYPES = [
  'EARTHING_SYSTEM',
  'HV_SWITCHGEAR',
  'LV_SWITCHGEAR',
  'TRANSFORMER_OIL',
  'TRANSFORMER_RESIN',
  'PFC_HV',
  'PFC_LV',
  'BUSDUCT',
  'DISTRIBUTION_BOARD',
  'UPS_SMALL',
  'UPS_LARGE',
  'BATTERY_SYSTEM',
  'VSD',
  'MOTORS_HV',
  'MOTORS_LV',
  'ATEX_EQUIPMENT',
  'EMERGENCY_LIGHTING',
  'FIRE_ALARM'
];

export const TSD_LIBRARY = {
  EARTHING_SYSTEM: [
    {
      id: 'earth_electrode_inspection',
      label: 'Inspection visuelle des conducteurs de mise à la terre',
      field: 'earth_electrode_inspection',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 12,
      procedure_md: 'Inspecter visuellement tous les conducteurs de terre, vérifier continuité, fixations et absence de corrosion.',
      hazards_md: 'Risque de choc électrique lors de la manipulation.',
      ppe_md: 'Gants isolants, lunettes de sécurité.',
      tools_md: 'Tournevis isolé, multimètre.'
    },
    {
      id: 'earth_resistance_test',
      label: 'Mesure de la résistance de terre',
      field: 'earth_resistance',
      type: 'number',
      unit: 'Ω',
      comparator: '<=',
      threshold: 100,
      frequency_months: 60,
      procedure_md: 'Effectuer une mesure à l\'ohmmètre pour vérifier la résistance globale du système de terre.',
      hazards_md: 'Exposition aux conducteurs sous tension.',
      ppe_md: 'Gants isolants, chaussures de sécurité.',
      tools_md: 'Ohmmètre de terre homologué.'
    }
  ],

  HV_SWITCHGEAR: [
    {
      id: 'hv_visual_clean_dry',
      label: 'Inspection visuelle : salle propre et sèche',
      field: 'hv_visu_room',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 3,
      procedure_md: 'Vérifier que la salle HT est propre, sèche, sans poussière ni humidité.',
      hazards_md: 'Arc électrique possible en cas de contamination.',
      ppe_md: 'Casque, gants isolants, visière.',
      tools_md: 'Lampe torche, caméra thermique.'
    },
    {
      id: 'hv_protection_test',
      label: 'Test des protections HT',
      field: 'hv_protection_trip',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 12,
      procedure_md: 'Effectuer un déclenchement de test des protections et vérifier la sélectivité.',
      hazards_md: 'Risque de déclenchement intempestif.',
      ppe_md: 'Gants isolants, vêtements ignifugés.',
      tools_md: 'Injecteur secondaire, multimètre.'
    }
  ],

  TRANSFORMER_OIL: [
    {
      id: 'oil_dga_test',
      label: 'Analyse diélectrique de l’huile (DGA)',
      field: 'oil_dga',
      type: 'number',
      unit: 'kV',
      comparator: '>=',
      threshold: 30,
      frequency_months: 36,
      procedure_md: 'Prélever un échantillon d’huile et réaliser un essai diélectrique en laboratoire.',
      hazards_md: 'Risque de fuite d’huile chaude.',
      ppe_md: 'Gants, lunettes, combinaison anti-huile.',
      tools_md: 'Kit de prélèvement, bouteille stérile.'
    }
  ],

  UPS_LARGE: [
    {
      id: 'ups_autonomy_test',
      label: 'Test d’autonomie de l’onduleur',
      field: 'ups_autonomy',
      type: 'number',
      unit: 'min',
      comparator: '>=',
      threshold: 30,
      frequency_months: 12,
      procedure_md: 'Déconnecter le réseau et mesurer la durée de maintien de la charge critique.',
      hazards_md: 'Risque d’arrêt des équipements sensibles.',
      ppe_md: 'Aucun spécifique (surveillance).',
      tools_md: 'Chronomètre, multimètre.'
    }
  ],

  ATEX_EQUIPMENT: [
    {
      id: 'atex_visual_check',
      label: 'Contrôle visuel des équipements ATEX',
      field: 'atex_visual',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 12,
      procedure_md: 'Inspecter boîtiers, presse-étoupes, joints et certifications marquées CE.',
      hazards_md: 'Risque d’explosion en zone ATEX.',
      ppe_md: 'Chaussures anti-décharge, combinaison antistatique.',
      tools_md: 'Clé dynamométrique ATEX, lampe ATEX.'
    }
  ],

  EMERGENCY_LIGHTING: [
    {
      id: 'emergency_light_test',
      label: 'Test mensuel éclairage de sécurité',
      field: 'emergency_light_test',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 1,
      procedure_md: 'Mettre hors tension le circuit normal et vérifier que l’éclairage de secours s’allume.',
      hazards_md: 'Risque d’obscurité temporaire.',
      ppe_md: 'Aucun spécifique.',
      tools_md: 'Chronomètre.'
    }
  ],

  FIRE_ALARM: [
    {
      id: 'fire_alarm_test',
      label: 'Test mensuel alarme incendie',
      field: 'fire_alarm',
      type: 'check',
      comparator: '==',
      threshold: true,
      frequency_months: 1,
      procedure_md: 'Déclencher un détecteur de fumée ou appuyer sur un déclencheur manuel, vérifier le déclenchement de l’alarme sonore.',
      hazards_md: 'Nuisance sonore.',
      ppe_md: 'Bouchons d’oreille.',
      tools_md: 'Aucun.'
    }
  ]
};

// Ajout de métadonnées manquantes (fallback)
Object.keys(TSD_LIBRARY).forEach(type => {
  TSD_LIBRARY[type].forEach(item => {
    item.procedure_md = item.procedure_md || 'Suivre la procédure standard pour ce contrôle.';
    item.hazards_md = item.hazards_md || 'Risque électrique standard.';
    item.ppe_md = item.ppe_md || 'Gants isolants, lunettes de sécurité.';
    item.tools_md = item.tools_md || 'Outils standard de maintenance.';
  });
});
