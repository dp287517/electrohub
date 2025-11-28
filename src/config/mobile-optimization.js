// src/config/mobile-optimization.js
// Configuration pour améliorer les performances sur mobile

/**
 * Détecte si l'appareil est un mobile
 */
export function isMobileDevice() {
  if (typeof window === "undefined") return false;
  
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  
  // Check for mobile devices
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  if (mobileRegex.test(userAgent.toLowerCase())) return true;
  
  // Check for small screens
  if (window.innerWidth <= 768) return true;
  
  // Check for touch screen
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    return window.innerWidth <= 1024;
  }
  
  return false;
}

/**
 * Détecte la qualité de connexion réseau
 */
export function getNetworkQuality() {
  if (typeof window === "undefined" || !navigator.connection) {
    return "unknown";
  }
  
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  
  if (!connection) return "unknown";
  
  // Slow 2G, 2G, 3G = slow
  if (connection.effectiveType === "slow-2g" || connection.effectiveType === "2g") {
    return "slow";
  }
  
  if (connection.effectiveType === "3g") {
    return "medium";
  }
  
  // 4G = fast
  return "fast";
}

/**
 * Configuration PDF selon le type d'appareil
 */
export function getPDFConfig() {
  const isMobile = isMobileDevice();
  const networkQuality = getNetworkQuality();
  
  // Configuration par défaut (PC / réseau rapide)
  let config = {
    qualityBoost: 3.5,
    maxBitmapWidth: 12288,
    minBitmapWidth: 1800,
    maxScale: 6.0,
    minScale: 0.75,
    enableImageSmoothing: true,
    intent: "display",
  };
  
  // Mobile + réseau lent
  if (isMobile && networkQuality === "slow") {
    config = {
      qualityBoost: 1.5,      // ⬇️ Réduit de 3.5 à 1.5
      maxBitmapWidth: 2048,   // ⬇️ Réduit de 12288 à 2048
      minBitmapWidth: 800,    // ⬇️ Réduit de 1800 à 800
      maxScale: 2.0,          // ⬇️ Réduit de 6.0 à 2.0
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "display",
    };
  }
  // Mobile + réseau moyen
  else if (isMobile && networkQuality === "medium") {
    config = {
      qualityBoost: 2.0,
      maxBitmapWidth: 4096,
      minBitmapWidth: 1024,
      maxScale: 3.0,
      minScale: 0.6,
      enableImageSmoothing: true,
      intent: "display",
    };
  }
  // Mobile + réseau rapide
  else if (isMobile) {
    config = {
      qualityBoost: 2.5,
      maxBitmapWidth: 6144,
      minBitmapWidth: 1200,
      maxScale: 4.0,
      minScale: 0.7,
      enableImageSmoothing: true,
      intent: "display",
    };
  }
  
  return config;
}

/**
 * Configuration de chargement lazy
 */
export function getLazyLoadConfig() {
  const isMobile = isMobileDevice();
  
  return {
    // Ne charger les plans que quand on entre dans l'onglet
    lazyLoadPlans: true,
    
    // Ne charger les équipements que quand le PDF est rendu
    lazyLoadEquipments: true,
    
    // Délai avant de charger les sous-zones (pour prioriser les marqueurs)
    subareasLoadDelay: isMobile ? 500 : 0,
    
    // Charger les positions par batch
    batchSize: isMobile ? 50 : 100,
    
    // Timeout pour les requêtes réseau
    networkTimeout: isMobile ? 30000 : 15000,
  };
}

/**
 * Affiche les informations de diagnostic
 */
export function logDeviceInfo() {
  const isMobile = isMobileDevice();
  const networkQuality = getNetworkQuality();
  const pdfConfig = getPDFConfig();
  
  console.group("📱 Device & Network Info");
  console.log("Mobile:", isMobile);
  console.log("Screen size:", `${window.innerWidth}x${window.innerHeight}`);
  console.log("Device pixel ratio:", window.devicePixelRatio);
  console.log("Network quality:", networkQuality);
  console.log("PDF config:", pdfConfig);
  console.groupEnd();
}
