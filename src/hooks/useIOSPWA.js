// Hook to detect iOS/iPadOS in PWA standalone mode
// Used to apply performance optimizations for iOS PWA

import { useState, useEffect } from 'react';

export function useIOSPWA() {
  const [isIOSPWA, setIsIOSPWA] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    // Detect iOS/iPadOS (including iPad with desktop user agent)
    const isIOSDevice = () => {
      const ua = navigator.userAgent;

      // Check for iPhone/iPad/iPod
      if (/iPad|iPhone|iPod/.test(ua)) return true;

      // iPad with iOS 13+ uses desktop user agent, detect via platform + touch
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;

      // Alternative: check for Safari on Mac with touch support (likely iPad)
      if (/Macintosh/.test(ua) && 'ontouchend' in document) return true;

      return false;
    };

    // Detect PWA standalone mode
    const isPWAMode = () => {
      // iOS standalone mode
      if (window.navigator.standalone === true) return true;

      // Standard display-mode media query
      if (window.matchMedia('(display-mode: standalone)').matches) return true;

      // Fullscreen mode (some PWAs)
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;

      return false;
    };

    const iosDevice = isIOSDevice();
    const pwaMode = isPWAMode();

    setIsIOS(iosDevice);
    setIsPWA(pwaMode);
    setIsIOSPWA(iosDevice && pwaMode);

    // Log for debugging
    if (iosDevice && pwaMode) {
      console.log('[PWA] iOS/iPadOS PWA mode detected - applying performance optimizations');
    }
  }, []);

  return { isIOSPWA, isIOS, isPWA };
}

export default useIOSPWA;
