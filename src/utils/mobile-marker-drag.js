// src/utils/mobile-marker-drag.js
// Utilitaire simple pour désactiver le drag des markers sur mobile/tablette

import { isMobileDevice } from "../config/mobile-optimization";

/**
 * Détecte si l'appareil supporte le touch
 */
function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Détermine si un marker doit être draggable
 * Sur mobile/tablette avec touch : JAMAIS draggable (évite les déplacements accidentels)
 * Sur desktop : selon la valeur passée
 *
 * @param {boolean} wantsDraggable - Si on veut que le marker soit draggable (logique métier)
 * @returns {boolean} - La valeur à utiliser pour l'option draggable de L.marker
 */
export function getMarkerDraggableOption(wantsDraggable = true) {
  // Si on ne veut pas de drag, retourner false
  if (!wantsDraggable) return false;

  // Sur mobile/tablette avec touch, désactiver le drag
  if (isMobileDevice() && isTouchDevice()) {
    return false;
  }

  // Sur desktop, drag normal
  return true;
}
