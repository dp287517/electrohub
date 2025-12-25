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
  'gants': ['gants', 'protection mains', 'isolants'],
  'harnais': ['harnais', 'antichute', 'longe'],
  'chaussures': ['chaussures de sécurité', 'chaussures'],
  'antibruit': ['antibruit', 'protection auditive', 'bouchons d\'oreilles', 'casque antibruit'],
  'gilet': ['gilet', 'haute visibilité', 'hi-vis', 'fluorescent'],
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

export {
  SAFETY_EQUIPMENT,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_KEYWORDS,
  detectEquipmentFromText,
  getEquipment,
  getEquipmentByCategory,
  getMandatoryEquipment,
  getEquipmentForProcedure,
};
