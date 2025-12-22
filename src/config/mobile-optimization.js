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
 * Détecte si l'appareil est bas de gamme (téléphones chinois, vieux Android, etc.)
 * Critères : peu de RAM, peu de cœurs CPU, ou petit écran avec faible DPR
 */
export function isLowEndDevice() {
  if (typeof window === "undefined") return false;

  // Vérifier la RAM (si disponible) - < 4 Go = bas de gamme
  const ram = navigator.deviceMemory; // en Go
  if (ram && ram < 4) return true;

  // Vérifier les cœurs CPU - < 4 cœurs = bas de gamme
  const cores = navigator.hardwareConcurrency;
  if (cores && cores < 4) return true;

  // Petit écran avec faible DPR = probablement bas de gamme
  const dpr = window.devicePixelRatio || 1;
  const screenWidth = window.screen?.width || window.innerWidth;
  if (screenWidth < 400 && dpr < 2) return true;

  // Vérifier les vieux Android (via User Agent)
  const ua = navigator.userAgent.toLowerCase();
  if (/android\s*[4-6]\./i.test(ua)) return true; // Android 4.x à 6.x

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
 * 🚀 ULTRA HAUTE RÉSOLUTION pour plans techniques détaillés
 * ⚡ Optimisé pour téléphones bas de gamme (Xiaomi, Redmi, Realme, etc.)
 */
export function getPDFConfig() {
  const isMobile = isMobileDevice();
  const isLowEnd = isLowEndDevice();
  const networkQuality = getNetworkQuality();

  // Adapter la qualité au DPR de l'écran
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const isHighDPI = dpr >= 2;
  const isVeryHighDPI = dpr >= 2.5;

  // 🔥 PC - ULTRA HAUTE QUALITÉ pour plans détaillés
  let config = {
    qualityBoost: 3.0,            // Très haute résolution
    maxBitmapWidth: 6000,         // 6K pour plans détaillés
    minBitmapWidth: 2000,
    maxScale: 5.0,                // Zoom profond possible
    minScale: 0.5,
    enableImageSmoothing: true,
    intent: "print",  // "print" = qualité maximale
    useHighQualityFormat: true,
  };

  // 📱 TÉLÉPHONE BAS DE GAMME → Compromis mémoire/qualité
  if (isMobile && isLowEnd) {
    config = {
      qualityBoost: 1.8,           // Augmenté pour netteté
      maxBitmapWidth: 2400,        // Augmenté
      minBitmapWidth: 1200,
      maxScale: 2.5,
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "print",  // "print" = qualité maximale
      useHighQualityFormat: true,
    };
  }
  // Mobile + réseau lent
  else if (isMobile && networkQuality === "slow") {
    config = {
      qualityBoost: isVeryHighDPI ? 2.5 : (isHighDPI ? 2.2 : 1.8),
      maxBitmapWidth: isVeryHighDPI ? 3500 : (isHighDPI ? 3000 : 2500),
      minBitmapWidth: 1400,
      maxScale: isVeryHighDPI ? 3.5 : (isHighDPI ? 3.0 : 2.5),
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "print",  // "print" = qualité maximale
      useHighQualityFormat: true,
    };
  }
  // Mobile + réseau moyen
  else if (isMobile && networkQuality === "medium") {
    config = {
      qualityBoost: isVeryHighDPI ? 2.8 : (isHighDPI ? 2.5 : 2.0),
      maxBitmapWidth: isVeryHighDPI ? 4000 : (isHighDPI ? 3500 : 3000),
      minBitmapWidth: 1600,
      maxScale: isVeryHighDPI ? 4.0 : (isHighDPI ? 3.5 : 3.0),
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "print",  // "print" = qualité maximale
      useHighQualityFormat: true,
    };
  }
  // Mobile + réseau rapide → Qualité maximale
  else if (isMobile) {
    config = {
      qualityBoost: isVeryHighDPI ? 3.0 : (isHighDPI ? 2.8 : 2.2),
      maxBitmapWidth: isVeryHighDPI ? 5000 : (isHighDPI ? 4500 : 3500),
      minBitmapWidth: 1800,
      maxScale: isVeryHighDPI ? 4.5 : (isHighDPI ? 4.0 : 3.5),
      minScale: 0.5,
      enableImageSmoothing: true,
      intent: "print",  // "print" = qualité maximale
      useHighQualityFormat: true,
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
  const isLowEnd = isLowEndDevice();
  const networkQuality = getNetworkQuality();
  const pdfConfig = getPDFConfig();

  console.group("📱 Device & Network Info");
  console.log("Mobile:", isMobile);
  console.log("Low-end device:", isLowEnd);
  console.log("Screen size:", `${window.innerWidth}x${window.innerHeight}`);
  console.log("Device pixel ratio:", window.devicePixelRatio);
  console.log("RAM:", navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "unknown");
  console.log("CPU cores:", navigator.hardwareConcurrency || "unknown");
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
 * Génère le format d'image optimal - PNG PARTOUT pour netteté parfaite
 * PNG = lossless = texte et lignes parfaitement nets
 * Le cache compense la taille plus importante du PNG
 */
export function getOptimalImageFormat(canvas, config = {}) {
  // ⚡ TOUJOURS PNG pour une netteté parfaite (lossless)
  // Le système de cache rend le chargement instantané après la première visite
  return canvas.toDataURL("image/png");
}
