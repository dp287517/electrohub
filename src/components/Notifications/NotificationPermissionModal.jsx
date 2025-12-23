// NotificationPermissionModal.jsx
// Beautiful Uber-style permission request modal
import React, { useState } from 'react';
import { Bell, X, Zap, Clock, Shield, ChevronRight } from 'lucide-react';

export default function NotificationPermissionModal({ isOpen, onAllow, onDismiss }) {
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);

  if (!isOpen) return null;

  const handleAllow = async () => {
    setIsLoading(true);
    await onAllow();
    setIsLoading(false);
  };

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

  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onDismiss}
      />

      {/* Modal */}
      <div className="relative w-full sm:max-w-md mx-auto bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slideUp">
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* Header with animated icon */}
        <div className="relative pt-12 pb-8 px-6 text-center bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900">
          {/* Animated notification icon */}
          <div className="relative inline-flex">
            {/* Pulse rings */}
            <div className="absolute inset-0 animate-ping-slow">
              <div className="w-20 h-20 rounded-full bg-black/5 dark:bg-white/5" />
            </div>
            <div className="absolute inset-2 animate-ping-slower">
              <div className="w-16 h-16 rounded-full bg-black/10 dark:bg-white/10" />
            </div>

            {/* Icon container */}
            <div className="relative w-20 h-20 rounded-full bg-black dark:bg-white flex items-center justify-center shadow-xl">
              <Bell className="w-10 h-10 text-white dark:text-black animate-wiggle" />
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
      `}</style>
    </div>
  );
}
