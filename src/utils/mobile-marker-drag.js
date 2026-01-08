// src/utils/mobile-marker-drag.js
// Utilitaire pour gérer le drag des markers sur mobile avec long-press

import { isMobileDevice } from "../config/mobile-optimization";

/**
 * Durée du long-press pour activer le drag (en ms)
 */
const LONG_PRESS_DURATION = 500;

/**
 * Détecte si l'appareil supporte le touch
 */
export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Vérifie si on doit utiliser le mode long-press (mobile/tablette avec touch)
 */
export function shouldUseLongPressDrag() {
  return isMobileDevice() && isTouchDevice();
}

/**
 * Déclenche une vibration haptic si supportée
 */
function triggerHapticFeedback() {
  if (navigator.vibrate) {
    navigator.vibrate(50); // Vibration courte de 50ms
  }
}

/**
 * Configure le drag mobile avec long-press pour un marker Leaflet
 *
 * Sur mobile/tablette :
 * - Le marker n'est PAS draggable par défaut
 * - Un long-press (500ms) active le mode drag
 * - Feedback visuel (classe CSS) + vibration
 * - Le drag se termine au touchend
 *
 * Sur desktop :
 * - Comportement inchangé (drag direct)
 *
 * @param {L.Marker} marker - Le marker Leaflet
 * @param {Object} options - Options
 * @param {boolean} options.initiallyDraggable - Si true sur desktop, le marker est draggable (défaut: true)
 * @param {Function} options.onDragActivated - Callback quand le drag est activé par long-press
 * @param {Function} options.onDragDeactivated - Callback quand le drag est désactivé
 * @returns {Function} Fonction de cleanup pour supprimer les listeners
 */
export function setupMobileDrag(marker, options = {}) {
  const {
    initiallyDraggable = true,
    onDragActivated,
    onDragDeactivated,
  } = options;

  // Sur desktop, garder le comportement normal
  if (!shouldUseLongPressDrag()) {
    if (initiallyDraggable) {
      marker.dragging?.enable?.();
    }
    return () => {}; // Pas de cleanup nécessaire
  }

  // Sur mobile : désactiver le drag par défaut
  marker.dragging?.disable?.();

  // Flag pour indiquer que le drag est actif (utilisé par le code de menu contextuel)
  marker._mobileDragActive = false;

  let longPressTimer = null;
  let isDragActivated = false;
  let startTouch = null;

  const activateDrag = () => {
    if (isDragActivated) return;
    isDragActivated = true;
    marker._mobileDragActive = true;

    // Activer le drag
    marker.dragging?.enable?.();

    // Feedback visuel
    const el = marker.getElement?.();
    if (el) {
      el.classList.add("mobile-drag-active");
    }

    // Vibration haptic
    triggerHapticFeedback();

    // Callback
    onDragActivated?.();
  };

  const deactivateDrag = () => {
    if (!isDragActivated) return;
    isDragActivated = false;
    marker._mobileDragActive = false;

    // Désactiver le drag
    marker.dragging?.disable?.();

    // Retirer le feedback visuel
    const el = marker.getElement?.();
    if (el) {
      el.classList.remove("mobile-drag-active");
    }

    // Callback
    onDragDeactivated?.();
  };

  const cancelLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    startTouch = { x: touch.clientX, y: touch.clientY };

    cancelLongPress();
    longPressTimer = setTimeout(() => {
      activateDrag();
    }, LONG_PRESS_DURATION);
  };

  const handleTouchMove = (e) => {
    // Si le drag n'est pas activé, annuler le long-press si on bouge trop
    if (!isDragActivated && startTouch) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startTouch.x);
      const dy = Math.abs(touch.clientY - startTouch.y);

      // Si mouvement > 10px, annuler le long-press (l'utilisateur veut pan la carte)
      if (dx > 10 || dy > 10) {
        cancelLongPress();
      }
    }
  };

  const handleTouchEnd = () => {
    cancelLongPress();

    // Désactiver le drag après un court délai pour permettre au dragend de se déclencher
    if (isDragActivated) {
      setTimeout(() => {
        deactivateDrag();
      }, 100);
    }
  };

  const handleTouchCancel = () => {
    cancelLongPress();
    deactivateDrag();
  };

  // Attendre que l'élément DOM soit disponible
  const setupListeners = () => {
    const el = marker.getElement?.();
    if (!el) {
      // Réessayer après un court délai
      setTimeout(setupListeners, 50);
      return;
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });
  };

  // Configurer les listeners
  setTimeout(setupListeners, 50);

  // Retourner la fonction de cleanup
  return () => {
    cancelLongPress();
    marker._mobileDragActive = false;
    const el = marker.getElement?.();
    if (el) {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
      el.classList.remove("mobile-drag-active");
    }
  };
}

/**
 * Détermine si un marker doit être créé avec draggable:true ou false
 *
 * @param {boolean} wantsDraggable - Si on veut que le marker soit draggable (logique métier)
 * @returns {boolean} - La valeur à utiliser pour l'option draggable de L.marker
 */
export function getMarkerDraggableOption(wantsDraggable = true) {
  // Si on ne veut pas de drag, retourner false
  if (!wantsDraggable) return false;

  // Sur mobile avec touch, on désactive le drag initial (sera activé par long-press)
  if (shouldUseLongPressDrag()) {
    return false;
  }

  // Sur desktop, drag normal
  return true;
}
