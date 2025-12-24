// NotificationPermissionModal.jsx
// Beautiful Uber-style permission request modal
// Optimized for iOS/iPadOS PWA performance
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, Zap, Clock, Shield, ChevronRight } from 'lucide-react';

export default function NotificationPermissionModal({ isOpen, onAllow, onDismiss }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isIOSPWA, setIsIOSPWA] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const modalRef = useRef(null);
  const backdropClickedRef = useRef(false);

  // Detect iOS/iPadOS PWA mode for performance optimizations
  useEffect(() => {
    const isIOSDevice = () => {
      const ua = navigator.userAgent;
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
      if (/Macintosh/.test(ua) && 'ontouchend' in document) return true;
      return false;
    };

    const isPWAMode = () => {
      if (window.navigator.standalone === true) return true;
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      return false;
    };

    const result = isIOSDevice() && isPWAMode();
    setIsIOSPWA(result);
    if (result) {
      console.log('[Modal] iOS PWA mode - using optimized rendering');
    }
  }, []);

  // Delay visibility to prevent immediate close on iOS
  useEffect(() => {
    if (isOpen) {
      // Small delay to prevent touch event bleed-through on iOS PWA
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleAllow = async () => {
    setIsLoading(true);
    await onAllow();
    setIsLoading(false);
  };

  // Handle backdrop click with iOS-safe touch handling
  const handleBackdropClick = useCallback((e) => {
    // Prevent if the click originated from inside the modal
    if (modalRef.current && modalRef.current.contains(e.target)) {
      return;
    }
    // Only dismiss if the modal has been visible for a bit (prevents ghost clicks)
    if (isVisible) {
      onDismiss();
    }
  }, [isVisible, onDismiss]);

  // Handle touch start on backdrop - track that a touch started on backdrop
  const handleBackdropTouchStart = useCallback((e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      backdropClickedRef.current = true;
    }
  }, []);

  // Handle touch end on backdrop - only dismiss if touch started and ended on backdrop
  const handleBackdropTouchEnd = useCallback((e) => {
    if (backdropClickedRef.current && modalRef.current && !modalRef.current.contains(e.target)) {
      e.preventDefault(); // Prevent ghost click
      if (isVisible) {
        onDismiss();
      }
    }
    backdropClickedRef.current = false;
  }, [isVisible, onDismiss]);

  // Stop propagation on modal content
  const handleModalClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  const benefits = [
    {
      icon: Zap,
      title: 'Alertes instantanées',
      description: 'Soyez averti immédiatement des contrôles urgents'
    },
    {
      icon: Clock,
      title: 'Rappels intelligents',
      description: 'Ne manquez plus jamais une échéance'
    },
    {
      icon: Shield,
      title: 'Toujours en conformité',
      description: 'Restez informé des non-conformités critiques'
    }
  ];

  // Use simpler styles for iOS PWA to improve performance
  const backdropClass = isIOSPWA
    ? 'absolute inset-0 bg-black/60 transition-opacity duration-200'
    : 'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300';

  const animationClass = isIOSPWA
    ? 'animate-slideUpSimple'
    : 'animate-slideUp';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center"
      onTouchStart={handleBackdropTouchStart}
      onTouchEnd={handleBackdropTouchEnd}
    >
      {/* Backdrop */}
      <div
        className={backdropClass}
        onClick={handleBackdropClick}
        style={{ touchAction: 'none' }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative w-full sm:max-w-md mx-auto bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden ${animationClass}`}
        onClick={handleModalClick}
        onTouchStart={handleModalClick}
        style={{
          transform: 'translateZ(0)', // Force GPU acceleration
          WebkitTransform: 'translateZ(0)'
        }}
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors z-10"
          style={{ touchAction: 'manipulation' }}
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* Header with animated icon */}
        <div className="relative pt-12 pb-8 px-6 text-center bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900">
          {/* Animated notification icon - simplified on iOS PWA */}
          <div className="relative inline-flex">
            {/* Pulse rings - disabled on iOS PWA for performance */}
            {!isIOSPWA && (
              <>
                <div className="absolute inset-0 animate-ping-slow">
                  <div className="w-20 h-20 rounded-full bg-black/5 dark:bg-white/5" />
                </div>
                <div className="absolute inset-2 animate-ping-slower">
                  <div className="w-16 h-16 rounded-full bg-black/10 dark:bg-white/10" />
                </div>
              </>
            )}

            {/* Icon container */}
            <div className="relative w-20 h-20 rounded-full bg-black dark:bg-white flex items-center justify-center shadow-xl">
              <Bell className={`w-10 h-10 text-white dark:text-black ${isIOSPWA ? '' : 'animate-wiggle'}`} />
              {/* Notification dot */}
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                <span className="text-white text-xs font-bold">3</span>
              </div>
            </div>
          </div>

          <h2 className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">
            Restez informé
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400 text-base">
            Activez les notifications pour ne rien manquer
          </p>
        </div>

        {/* Benefits list */}
        <div className="px-6 py-4 space-y-1">
          {benefits.map((benefit, index) => (
            <div
              key={index}
              className="flex items-start gap-4 p-3 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <benefit.icon className="w-6 h-6 text-gray-900 dark:text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {benefit.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {benefit.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="p-6 pt-4 space-y-3">
          {/* Primary button */}
          <button
            onClick={handleAllow}
            disabled={isLoading}
            className="w-full py-4 px-6 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-2xl
                       hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-[0.98] transition-all duration-150
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ touchAction: 'manipulation' }}
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Activation...</span>
              </>
            ) : (
              <>
                <Bell className="w-5 h-5" />
                <span>Activer les notifications</span>
              </>
            )}
          </button>

          {/* Secondary button */}
          <button
            onClick={onDismiss}
            className="w-full py-3 px-6 text-gray-500 dark:text-gray-400 font-medium rounded-2xl
                       hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            style={{ touchAction: 'manipulation' }}
          >
            Peut-être plus tard
          </button>
        </div>

        {/* Footer note */}
        <div className="px-6 pb-6">
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            Vous pourrez modifier vos préférences à tout moment dans les paramètres
          </p>
        </div>
      </div>

      {/* Custom animations */}
      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideUpSimple {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes ping-slow {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          75%, 100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }

        @keyframes ping-slower {
          0% {
            transform: scale(1);
            opacity: 0.3;
          }
          75%, 100% {
            transform: scale(1.8);
            opacity: 0;
          }
        }

        @keyframes wiggle {
          0%, 100% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(-10deg);
          }
          75% {
            transform: rotate(10deg);
          }
        }

        .animate-slideUp {
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .animate-slideUpSimple {
          animation: slideUpSimple 0.25s ease-out;
        }

        .animate-ping-slow {
          animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }

        .animate-ping-slower {
          animation: ping-slower 2s cubic-bezier(0, 0, 0.2, 1) infinite;
          animation-delay: 0.5s;
        }

        .animate-wiggle {
          animation: wiggle 1s ease-in-out infinite;
          animation-delay: 2s;
        }

        /* Reduce motion for accessibility and performance */
        @media (prefers-reduced-motion: reduce) {
          .animate-slideUp,
          .animate-slideUpSimple,
          .animate-ping-slow,
          .animate-ping-slower,
          .animate-wiggle {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
