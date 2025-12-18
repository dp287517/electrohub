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
 * 🚀 VERSION ULTRA-OPTIMISÉE pour chargement rapide
 */
export function getPDFConfig() {
  const isMobile = isMobileDevice();
  const networkQuality = getNetworkQuality();

  // 🔥 Configuration ULTRA-LÉGÈRE par défaut (PC / réseau rapide)
  // Réduit drastiquement pour un chargement instantané
  let config = {
    qualityBoost: 1.5,        // ⬇️ Réduit de 3.5 à 1.5
    maxBitmapWidth: 3000,     // ⬇️ Réduit de 12288 à 3000
    minBitmapWidth: 800,      // ⬇️ Réduit de 1800 à 800
    maxScale: 2.5,            // ⬇️ Réduit de 6.0 à 2.5
    minScale: 0.5,
    enableImageSmoothing: true,
    intent: "display",
  };

  // Mobile + réseau lent → ULTRA LÉGER
  if (isMobile && networkQuality === "slow") {
    config = {
      qualityBoost: 1.0,
      maxBitmapWidth: 1200,
      minBitmapWidth: 600,
      maxScale: 1.2,
      minScale: 0.4,
      enableImageSmoothing: false,
      intent: "display",
    };
  }
  // Mobile + réseau moyen
  else if (isMobile && networkQuality === "medium") {
    config = {
      qualityBoost: 1.2,
      maxBitmapWidth: 1800,
      minBitmapWidth: 700,
      maxScale: 1.8,
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "display",
    };
  }
  // Mobile + réseau rapide
  else if (isMobile) {
    config = {
      qualityBoost: 1.3,
      maxBitmapWidth: 2200,
      minBitmapWidth: 800,
      maxScale: 2.0,
      minScale: 0.5,
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

// ============================================================
// 🚀 CACHE SYSTEM - Évite le re-rendu PDF à chaque visite
// ============================================================

// Cache en mémoire pour les plans rendus (persiste pendant la session)
const planRenderCache = new Map();
const CACHE_MAX_ENTRIES = 10; // Max 10 plans en cache
const CACHE_MAX_SIZE_MB = 50; // Max 50MB total

/**
 * Génère une clé de cache unique pour un plan
 */
export function getPlanCacheKey(planKey, pageIndex, config) {
  return `${planKey}:${pageIndex}:${config.maxBitmapWidth}:${config.maxScale}`;
}

/**
 * Récupère un plan depuis le cache
 */
export function getCachedPlan(cacheKey) {
  const cached = planRenderCache.get(cacheKey);
  if (cached) {
    cached.lastAccess = Date.now();
    console.log(`[Cache] HIT pour ${cacheKey}`);
    return cached;
  }
  console.log(`[Cache] MISS pour ${cacheKey}`);
  return null;
}

/**
 * Stocke un plan rendu dans le cache
 */
export function cachePlan(cacheKey, dataUrl, width, height) {
  // Estimer la taille en MB (base64 = ~1.37x la taille binaire)
  const sizeMB = (dataUrl.length * 0.75) / (1024 * 1024);

  // Nettoyer le cache si nécessaire
  cleanupCache(sizeMB);

  planRenderCache.set(cacheKey, {
    dataUrl,
    width,
    height,
    sizeMB,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  });

  console.log(`[Cache] Stocké ${cacheKey} (${sizeMB.toFixed(2)}MB, total: ${planRenderCache.size} entrées)`);
}

/**
 * Nettoie le cache pour faire de la place
 */
function cleanupCache(neededMB = 0) {
  // Calculer la taille totale actuelle
  let totalMB = 0;
  for (const entry of planRenderCache.values()) {
    totalMB += entry.sizeMB || 0;
  }

  // Si on dépasse la limite, supprimer les plus anciens
  while (
    (planRenderCache.size >= CACHE_MAX_ENTRIES || totalMB + neededMB > CACHE_MAX_SIZE_MB) &&
    planRenderCache.size > 0
  ) {
    // Trouver l'entrée la moins récemment accédée
    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of planRenderCache.entries()) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const removed = planRenderCache.get(oldestKey);
      totalMB -= removed?.sizeMB || 0;
      planRenderCache.delete(oldestKey);
      console.log(`[Cache] Supprimé ${oldestKey} (LRU cleanup)`);
    } else {
      break;
    }
  }
}

/**
 * Vide complètement le cache
 */
export function clearPlanCache() {
  planRenderCache.clear();
  console.log("[Cache] Cache vidé");
}

/**
 * Génère le format d'image optimal (JPEG sur mobile, PNG sur desktop)
 * JPEG 0.85 = ~5-10x plus petit que PNG, qualité excellente pour plans
 */
export function getOptimalImageFormat(canvas) {
  const isMobile = isMobileDevice();
  if (isMobile) {
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  return canvas.toDataURL("image/png");
}
