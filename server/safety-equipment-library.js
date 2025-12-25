/**
 * Safety Equipment Library
 *
 * This library provides a catalog of safety equipment with images
 * for use in procedure documents (RAMS, Methodology, Procedure)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base path for equipment images
export const EQUIPMENT_IMAGES_PATH = path.join(__dirname, '..', 'public', 'safety-equipment');

// Equipment categories
const EQUIPMENT_CATEGORIES = {
  HEIGHT_ACCESS: 'height_access',
  HEAD_PROTECTION: 'head_protection',
  EYE_PROTECTION: 'eye_protection',
  HAND_PROTECTION: 'hand_protection',
  BODY_PROTECTION: 'body_protection',
  FOOT_PROTECTION: 'foot_protection',
  HEARING_PROTECTION: 'hearing_protection',
  FALL_PROTECTION: 'fall_protection',
  VISIBILITY: 'visibility',
  GAS_DETECTION: 'gas_detection',
  RESPIRATORY: 'respiratory',
  ELECTRICAL: 'electrical',
};

// Work Permit Types
export const WORK_PERMITS = {
  hot_work: {
    id: 'hot_work',
    name: 'Permis Feu',
    fullName: 'Permis de travail par point chaud',
    color: '#dc2626', // red
    icon: '🔥',
    description: 'Obligatoire pour soudure, meulage, découpe thermique',
    keywords: ['soudure', 'souder', 'meulage', 'meuler', 'découpe', 'chalumeau', 'point chaud', 'flamme', 'étincel', 'arc électrique', 'brasage'],
    requirements: ['Extincteur à proximité', 'Zone dégagée 10m', 'Surveillance 2h après'],
    validity: '8 heures',
  },

  electrical: {
    id: 'electrical',
    name: 'Permis Électrique',
    fullName: 'Permis de travail haute tension / consignation',
    color: '#eab308', // yellow
    icon: '⚡',
    description: 'Obligatoire pour travaux sur installations électriques HT/BT',
    keywords: ['haute tension', 'ht', 'consignation', 'déconsignation', 'habilitation', 'électrique', 'armoire électrique', 'disjoncteur', 'sectionneur', 'vat'],
    requirements: ['Habilitation électrique valide', 'VAT effectuée', 'MALT posée', 'Balisage'],
    validity: '24 heures',
  },

  confined_space: {
    id: 'confined_space',
    name: 'Permis Espace Confiné',
    fullName: 'Permis d\'entrée en espace confiné',
    color: '#7c3aed', // purple
    icon: '🚪',
    description: 'Obligatoire pour entrée en cuves, fosses, regards, canalisations',
    keywords: ['espace confiné', 'cuve', 'fosse', 'regard', 'puits', 'citerne', 'réservoir', 'canalisation', 'tunnel', 'galerie'],
    requirements: ['Détection atmosphérique', 'Ventilation', 'Surveillant extérieur', 'Moyens de secours'],
    validity: '8 heures',
  },

  work_at_height: {
    id: 'work_at_height',
    name: 'Permis Hauteur',
    fullName: 'Permis de travail en hauteur',
    color: '#2563eb', // blue
    icon: '🏗️',
    description: 'Obligatoire pour travaux au-dessus de 3m sans protection collective',
    keywords: ['hauteur', 'nacelle', 'échafaudage', 'toiture', 'toit', 'façade', 'pylône', 'antenne', 'harnais'],
    requirements: ['Harnais vérifié', 'Point d\'ancrage certifié', 'Formation travail en hauteur'],
    validity: '24 heures',
  },

  lone_worker: {
    id: 'lone_worker',
    name: 'Travailleur Isolé',
    fullName: 'Autorisation travailleur isolé (PTI/DATI)',
    color: '#ea580c', // orange
    icon: '👤',
    description: 'Obligatoire pour intervention seul hors vue/voix',
    keywords: ['isolé', 'seul', 'pti', 'dati', 'nuit', 'weekend', 'astreinte', 'garde'],
    requirements: ['Dispositif PTI actif', 'Check-in régulier', 'Procédure d\'alerte'],
    validity: 'Durée intervention',
  },

  excavation: {
    id: 'excavation',
    name: 'Permis Fouille',
    fullName: 'Permis de travail excavation/fouille',
    color: '#854d0e', // brown
    icon: '🕳️',
    description: 'Obligatoire pour travaux de terrassement et fouilles',
    keywords: ['fouille', 'excavation', 'tranchée', 'terrassement', 'creuser', 'pelleteuse', 'réseaux enterrés', 'dict'],
    requirements: ['DICT validée', 'Détection réseaux', 'Blindage si > 1.3m', 'Échelle d\'accès'],
    validity: '24 heures',
  },

  radiation: {
    id: 'radiation',
    name: 'Permis Radiologique',
    fullName: 'Permis de travail zone contrôlée/surveillée',
    color: '#059669', // teal
    icon: '☢️',
    description: 'Obligatoire pour intervention en zone radiologique',
    keywords: ['radioactif', 'radiation', 'zone contrôlée', 'rayon x', 'gamma', 'source scellée', 'gammagraphie'],
    requirements: ['Dosimètre actif', 'Formation PCR', 'Suivi dosimétrique'],
    validity: 'Selon RPE',
  },

  lifting: {
    id: 'lifting',
    name: 'Permis Levage',
    fullName: 'Permis de levage / manutention lourde',
    color: '#0891b2', // cyan
    icon: '🏋️',
    description: 'Obligatoire pour opérations de levage > 1 tonne',
    keywords: ['levage', 'grue', 'palan', 'pont roulant', 'élingue', 'charge lourde', 'manutention', 'caces'],
    requirements: ['Plan de levage', 'CACES valide', 'Élingage certifié', 'Chef de manœuvre'],
    validity: 'Durée opération',
  },
};

// Complete equipment library
const SAFETY_EQUIPMENT = {
  // Height Access Equipment
  pirl: {
    id: 'pirl',
    name: 'PIRL',
    fullName: 'Plateforme Individuelle Roulante Légère',
    category: EQUIPMENT_CATEGORIES.HEIGHT_ACCESS,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'pirl.svg'),
    description: 'Plateforme mobile pour travaux en hauteur jusqu\'à 2,5m',
    usage: 'Travaux légers en hauteur, maintenance, câblage',
    keywords: ['pirl', 'plateforme', 'marchepied', 'hauteur', 'escabeau roulant'],
    maxHeight: '2.5m',
    certification: 'EN 131-7',
  },

  echelle: {
    id: 'echelle',
    name: 'Échelle',
    fullName: 'Échelle de sécurité',
    category: EQUIPMENT_CATEGORIES.HEIGHT_ACCESS,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'echelle.svg'),
    description: 'Échelle simple ou coulissante pour accès en hauteur',
    usage: 'Accès ponctuel en hauteur, interventions courtes',
    keywords: ['échelle', 'ladder', 'escabeau', 'hauteur', 'montée'],
    certification: 'EN 131',
  },

  nacelle: {
    id: 'nacelle',
    name: 'Nacelle',
    fullName: 'Nacelle élévatrice / PEMP',
    category: EQUIPMENT_CATEGORIES.HEIGHT_ACCESS,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'nacelle.svg'),
    description: 'Plateforme élévatrice mobile de personnel (PEMP)',
    usage: 'Travaux en grande hauteur, façades, éclairage',
    keywords: ['nacelle', 'pemp', 'élévateur', 'lift', 'plateforme élévatrice', 'cherry picker'],
    requiresCertification: 'CACES R486',
    certification: 'EN 280',
  },

  // Personal Protective Equipment (PPE / EPI)
  casque: {
    id: 'casque',
    name: 'Casque',
    fullName: 'Casque de protection',
    category: EQUIPMENT_CATEGORIES.HEAD_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'casque.svg'),
    description: 'Casque de chantier avec jugulaire',
    usage: 'Protection contre les chutes d\'objets et chocs à la tête',
    keywords: ['casque', 'casque de chantier', 'helmet', 'tête', 'protection tête'],
    certification: 'EN 397',
    mandatory: true,
  },

  lunettes: {
    id: 'lunettes',
    name: 'Lunettes',
    fullName: 'Lunettes de protection',
    category: EQUIPMENT_CATEGORIES.EYE_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'lunettes.svg'),
    description: 'Lunettes avec protections latérales',
    usage: 'Protection contre projections, poussières, éclats',
    keywords: ['lunettes', 'glasses', 'yeux', 'protection oculaire', 'vue'],
    certification: 'EN 166',
  },

  gants: {
    id: 'gants',
    name: 'Gants',
    fullName: 'Gants de protection',
    category: EQUIPMENT_CATEGORIES.HAND_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'gants.svg'),
    description: 'Gants de manutention ou isolants selon le risque',
    usage: 'Protection des mains contre coupures, brûlures, électricité',
    keywords: ['gants', 'gloves', 'mains', 'protection mains', 'manutention'],
    variants: ['Gants mécaniques', 'Gants isolants', 'Gants anti-coupure'],
    certification: 'EN 388 / EN 60903',
  },

  harnais: {
    id: 'harnais',
    name: 'Harnais',
    fullName: 'Harnais antichute',
    category: EQUIPMENT_CATEGORIES.FALL_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'harnais.svg'),
    description: 'Harnais de sécurité avec point d\'ancrage dorsal',
    usage: 'Travaux en hauteur avec risque de chute',
    keywords: ['harnais', 'harness', 'antichute', 'chute', 'hauteur', 'longe'],
    accessories: ['Longe', 'Absorbeur', 'Point d\'ancrage'],
    certification: 'EN 361',
  },

  chaussures: {
    id: 'chaussures',
    name: 'Chaussures',
    fullName: 'Chaussures de sécurité',
    category: EQUIPMENT_CATEGORIES.FOOT_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'chaussures.svg'),
    description: 'Chaussures avec coque de protection et semelle anti-perforation',
    usage: 'Protection des pieds contre écrasement et perforation',
    keywords: ['chaussures', 'shoes', 'bottes', 'pieds', 'safety shoes', 'sécurité'],
    certification: 'EN ISO 20345 S3',
    mandatory: true,
  },

  antibruit: {
    id: 'antibruit',
    name: 'Protection auditive',
    fullName: 'Protection anti-bruit',
    category: EQUIPMENT_CATEGORIES.HEARING_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'antibruit.svg'),
    description: 'Casque anti-bruit ou bouchons d\'oreilles',
    usage: 'Protection contre les nuisances sonores > 85dB',
    keywords: ['antibruit', 'casque anti-bruit', 'bouchons', 'oreilles', 'bruit', 'ear protection'],
    attenuation: '-32dB',
    certification: 'EN 352',
  },

  gilet: {
    id: 'gilet',
    name: 'Gilet',
    fullName: 'Gilet haute visibilité',
    category: EQUIPMENT_CATEGORIES.VISIBILITY,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'gilet.svg'),
    description: 'Gilet fluorescent avec bandes réfléchissantes',
    usage: 'Visibilité sur chantier, zones de circulation',
    keywords: ['gilet', 'vest', 'haute visibilité', 'fluo', 'réfléchissant', 'hi-vis'],
    certification: 'EN ISO 20471',
    mandatory: true,
  },

  // Gas Detection & Respiratory
  detecteur_gaz: {
    id: 'detecteur_gaz',
    name: 'Détecteur gaz',
    fullName: 'Détecteur multi-gaz portable',
    category: EQUIPMENT_CATEGORIES.GAS_DETECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'detecteur_gaz.svg'),
    description: 'Détecteur 4 gaz (O2, CO, H2S, LIE)',
    usage: 'Espaces confinés, zones ATEX, travaux de soudure',
    keywords: ['détecteur', 'gaz', 'explosimètre', 'atex', 'atmosphère', 'oxygène', 'o2', 'h2s', 'co', 'lie'],
    certification: 'ATEX II 1G',
  },

  masque_respiratoire: {
    id: 'masque_respiratoire',
    name: 'Masque',
    fullName: 'Masque respiratoire / ARI',
    category: EQUIPMENT_CATEGORIES.RESPIRATORY,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'masque.svg'),
    description: 'Demi-masque filtrant ou appareil respiratoire isolant',
    usage: 'Protection contre poussières, vapeurs, gaz toxiques',
    keywords: ['masque', 'respiratoire', 'ffp', 'ari', 'filtre', 'cartouche', 'vapeur', 'poussière'],
    variants: ['FFP2/FFP3', 'Demi-masque à cartouche', 'ARI'],
    certification: 'EN 149 / EN 136',
  },

  gants_isolants: {
    id: 'gants_isolants',
    name: 'Gants isolants',
    fullName: 'Gants isolants électriques',
    category: EQUIPMENT_CATEGORIES.ELECTRICAL,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'gants_isolants.svg'),
    description: 'Gants isolants classe 00 à 4 selon tension',
    usage: 'Travaux sous tension, voisinage électrique',
    keywords: ['gants isolants', 'isolant', 'électrique', 'tension', 'classe 0', 'classe 1', 'classe 2'],
    certification: 'EN 60903',
  },

  ecran_facial: {
    id: 'ecran_facial',
    name: 'Écran facial',
    fullName: 'Écran de protection faciale',
    category: EQUIPMENT_CATEGORIES.EYE_PROTECTION,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'ecran_facial.svg'),
    description: 'Écran anti-projection ou arc électrique',
    usage: 'Meulage, soudure, risque arc électrique',
    keywords: ['écran', 'visière', 'facial', 'arc flash', 'soudure', 'meulage', 'projection'],
    certification: 'EN 166 / IEC 61482',
  },

  extincteur: {
    id: 'extincteur',
    name: 'Extincteur',
    fullName: 'Extincteur portatif',
    category: EQUIPMENT_CATEGORIES.VISIBILITY,
    imagePath: path.join(EQUIPMENT_IMAGES_PATH, 'extincteur.svg'),
    description: 'Extincteur CO2, poudre ou eau pulvérisée',
    usage: 'Point chaud, soudure, zone à risque incendie',
    keywords: ['extincteur', 'feu', 'incendie', 'co2', 'poudre', 'point chaud'],
    certification: 'NF EN 3',
  },
};

// Keywords mapping for automatic equipment detection
const EQUIPMENT_KEYWORDS = {
  // Height access
  'pirl': ['pirl'],
  'echelle': ['échelle', 'escabeau', 'ladder'],
  'nacelle': ['nacelle', 'pemp', 'élévateur', 'plateforme élévatrice', 'cherry picker', 'lift'],

  // PPE
  'casque': ['casque', 'helmet', 'protection tête'],
  'lunettes': ['lunettes', 'protection oculaire', 'yeux'],
  'gants': ['gants', 'protection mains'],
  'harnais': ['harnais', 'antichute', 'longe'],
  'chaussures': ['chaussures de sécurité', 'chaussures'],
  'antibruit': ['antibruit', 'protection auditive', 'bouchons d\'oreilles', 'casque antibruit'],
  'gilet': ['gilet', 'haute visibilité', 'hi-vis', 'fluorescent'],

  // Additional equipment
  'detecteur_gaz': ['détecteur', 'gaz', 'explosimètre', 'atex', 'atmosphère', 'oxygène'],
  'masque_respiratoire': ['masque', 'respiratoire', 'ffp', 'ari', 'filtre'],
  'gants_isolants': ['gants isolants', 'isolant électrique'],
  'ecran_facial': ['écran facial', 'visière', 'arc flash'],
  'extincteur': ['extincteur', 'point chaud', 'soudure', 'meulage'],
};

/**
 * Detect equipment from text content
 * @param {string} text - The text to analyze
 * @returns {Array} Array of equipment IDs detected
 */
function detectEquipmentFromText(text) {
  const detected = new Set();
  const lowerText = text.toLowerCase();

  for (const [equipmentId, keywords] of Object.entries(EQUIPMENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        detected.add(equipmentId);
        break;
      }
    }
  }

  return Array.from(detected);
}

/**
 * Get equipment data by ID
 * @param {string} id - Equipment ID
 * @returns {Object|null} Equipment data or null
 */
function getEquipment(id) {
  return SAFETY_EQUIPMENT[id] || null;
}

/**
 * Get all equipment in a category
 * @param {string} category - Category ID
 * @returns {Array} Array of equipment in the category
 */
function getEquipmentByCategory(category) {
  return Object.values(SAFETY_EQUIPMENT).filter(eq => eq.category === category);
}

/**
 * Get all mandatory equipment
 * @returns {Array} Array of mandatory equipment
 */
function getMandatoryEquipment() {
  return Object.values(SAFETY_EQUIPMENT).filter(eq => eq.mandatory);
}

/**
 * Get equipment for a procedure based on its steps
 * @param {Array} steps - Array of procedure steps
 * @returns {Array} Array of relevant equipment
 */
function getEquipmentForProcedure(steps) {
  const detected = new Set();

  // Always include mandatory equipment
  getMandatoryEquipment().forEach(eq => detected.add(eq.id));

  // Detect from step content
  steps.forEach(step => {
    const text = `${step.title || ''} ${step.instructions || ''} ${step.warning || ''}`;
    detectEquipmentFromText(text).forEach(id => detected.add(id));
  });

  return Array.from(detected).map(id => SAFETY_EQUIPMENT[id]).filter(Boolean);
}

/**
 * Detect required work permits from text content
 * @param {string} text - The text to analyze
 * @returns {Array} Array of permit IDs detected
 */
function detectPermitsFromText(text) {
  const detected = new Set();
  const lowerText = text.toLowerCase();

  for (const [permitId, permit] of Object.entries(WORK_PERMITS)) {
    for (const keyword of permit.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        detected.add(permitId);
        break;
      }
    }
  }

  return Array.from(detected);
}

/**
 * Get permit data by ID
 * @param {string} id - Permit ID
 * @returns {Object|null} Permit data or null
 */
function getPermit(id) {
  return WORK_PERMITS[id] || null;
}

/**
 * Get required permits for a procedure based on its steps
 * @param {Array} steps - Array of procedure steps
 * @param {Object} procedureData - Procedure metadata (title, description, etc.)
 * @returns {Array} Array of required permits with full data
 */
function getPermitsForProcedure(steps, procedureData = {}) {
  const detected = new Set();

  // Check procedure title and description
  const metaText = `${procedureData.title || ''} ${procedureData.description || ''}`;
  detectPermitsFromText(metaText).forEach(id => detected.add(id));

  // Check each step
  steps.forEach(step => {
    const text = `${step.title || ''} ${step.instructions || ''} ${step.warning || ''}`;
    detectPermitsFromText(text).forEach(id => detected.add(id));
  });

  return Array.from(detected).map(id => WORK_PERMITS[id]).filter(Boolean);
}

/**
 * Get all available permits
 * @returns {Array} Array of all permit types
 */
function getAllPermits() {
  return Object.values(WORK_PERMITS);
}

/**
 * Get all available equipment
 * @returns {Array} Array of all equipment types
 */
function getAllEquipment() {
  return Object.values(SAFETY_EQUIPMENT);
}

export {
  SAFETY_EQUIPMENT,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_KEYWORDS,
  WORK_PERMITS,
  detectEquipmentFromText,
  detectPermitsFromText,
  getEquipment,
  getPermit,
  getEquipmentByCategory,
  getMandatoryEquipment,
  getEquipmentForProcedure,
  getPermitsForProcedure,
  getAllPermits,
  getAllEquipment,
};
