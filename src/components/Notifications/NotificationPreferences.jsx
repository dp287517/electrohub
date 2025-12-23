// NotificationPreferences.jsx
// Beautiful Uber-style notification settings panel
import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellOff,
  Sun,
  Moon,
  Zap,
  Calendar,
  AlertTriangle,
  Settings,
  Smartphone,
  Check,
  X,
  ChevronRight,
  Clock,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useNotifications } from './NotificationProvider';

export default function NotificationPreferences({ isOpen, onClose }) {
  const {
    isSupported,
    permission,
    isSubscribed,
    preferences,
    subscribe,
    unsubscribe,
    updatePreferences,
    sendTestNotification,
    toast
  } = useNotifications();

  const [localPrefs, setLocalPrefs] = useState(preferences);
  const [isLoading, setIsLoading] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    setLocalPrefs(preferences);
  }, [preferences]);

  if (!isOpen) return null;

  const handleToggleNotifications = async () => {
    setIsLoading(true);
    try {
      if (isSubscribed) {
        await unsubscribe();
        toast.info('Notifications désactivées', 'Vous ne recevrez plus de notifications push');
      } else {
        const result = await subscribe();
        if (result.success) {
          toast.success('Notifications activées', 'Vous recevrez des alertes push');
        } else {
          toast.error('Erreur', result.error || 'Impossible d\'activer les notifications');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrefChange = async (key, value) => {
    const newPrefs = { ...localPrefs, [key]: value };
    setLocalPrefs(newPrefs);
    await updatePreferences(newPrefs);
  };

  const handleTestNotification = async () => {
    setTestSent(true);
    const result = await sendTestNotification();
    if (result.success) {
      toast.success('Test envoyé', 'Vous devriez recevoir une notification');
    } else {
      toast.error('Erreur', 'Impossible d\'envoyer le test');
    }
    setTimeout(() => setTestSent(false), 3000);
  };

  const notificationTypes = [
    {
      key: 'controlReminders',
      icon: Calendar,
      title: 'Rappels de contrôle',
      description: 'Notifications avant les échéances de contrôle',
      recommended: true
    },
    {
      key: 'overdueAlerts',
      icon: AlertTriangle,
      title: 'Alertes urgentes',
      description: 'Notifications pour les contrôles en retard',
      recommended: true
    },
    {
      key: 'morningBrief',
      icon: Sun,
      title: 'Brief du matin',
      description: 'Résumé quotidien de vos tâches à 8h',
      recommended: true
    },
    {
      key: 'systemUpdates',
      icon: Settings,
      title: 'Mises à jour système',
      description: 'Nouvelles fonctionnalités et améliorations',
      recommended: false
    }
  ];

  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full sm:max-w-lg mx-auto max-h-[90vh] bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black dark:bg-white rounded-xl flex items-center justify-center">
                <Bell className="w-5 h-5 text-white dark:text-black" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-gray-900 dark:text-white">
                  Notifications
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Gérez vos préférences
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Master toggle */}
          <div className="p-4">
            <div
              onClick={isSupported && !isLoading ? handleToggleNotifications : undefined}
              className={`
                relative overflow-hidden rounded-2xl p-4 cursor-pointer transition-all duration-300
                ${isSubscribed
                  ? 'bg-black dark:bg-white'
                  : 'bg-gray-100 dark:bg-gray-800'
                }
                ${!isSupported || isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}
              `}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`
                    w-12 h-12 rounded-2xl flex items-center justify-center transition-colors
                    ${isSubscribed
                      ? 'bg-white/20'
                      : 'bg-gray-200 dark:bg-gray-700'
                    }
                  `}>
                    {isSubscribed ? (
                      <Bell className="w-6 h-6 text-white dark:text-black" />
                    ) : (
                      <BellOff className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                    )}
                  </div>
                  <div>
                    <h3 className={`font-semibold ${isSubscribed ? 'text-white dark:text-black' : 'text-gray-900 dark:text-white'}`}>
                      Notifications push
                    </h3>
                    <p className={`text-sm ${isSubscribed ? 'text-white/70 dark:text-black/70' : 'text-gray-500 dark:text-gray-400'}`}>
                      {isSubscribed ? 'Activées' : 'Désactivées'}
                    </p>
                  </div>
                </div>

                {/* Toggle switch */}
                <div className={`
                  relative w-14 h-8 rounded-full transition-colors duration-300
                  ${isSubscribed ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}
                `}>
                  <div className={`
                    absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300
                    ${isSubscribed ? 'translate-x-7' : 'translate-x-1'}
                  `}>
                    {isLoading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {!isSupported && (
                <p className="mt-3 text-sm text-amber-500">
                  Les notifications push ne sont pas supportées sur ce navigateur
                </p>
              )}

              {permission === 'denied' && (
                <p className="mt-3 text-sm text-red-400">
                  Les notifications sont bloquées. Modifiez les paramètres de votre navigateur.
                </p>
              )}
            </div>
          </div>

          {/* Notification types */}
          {isSubscribed && (
            <div className="px-4 pb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
                Types de notifications
              </h3>
              <div className="space-y-2">
                {notificationTypes.map((notif) => (
                  <div
                    key={notif.key}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-sm">
                        <notif.icon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-white text-sm">
                            {notif.title}
                          </span>
                          {notif.recommended && (
                            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                              Recommandé
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {notif.description}
                        </p>
                      </div>
                    </div>

                    {/* Mini toggle */}
                    <button
                      onClick={() => handlePrefChange(notif.key, !localPrefs[notif.key])}
                      className={`
                        relative w-12 h-7 rounded-full transition-colors duration-200
                        ${localPrefs[notif.key] ? 'bg-black dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}
                      `}
                    >
                      <div className={`
                        absolute top-1 w-5 h-5 bg-white dark:bg-gray-900 rounded-full shadow transition-transform duration-200
                        ${localPrefs[notif.key] ? 'translate-x-6' : 'translate-x-1'}
                      `} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quiet hours */}
          {isSubscribed && (
            <div className="px-4 pb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
                Heures calmes
              </h3>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-sm">
                      <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                    </div>
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        Ne pas déranger
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Silence pendant ces heures
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handlePrefChange('quietHoursEnabled', !localPrefs.quietHoursEnabled)}
                    className={`
                      relative w-12 h-7 rounded-full transition-colors duration-200
                      ${localPrefs.quietHoursEnabled ? 'bg-black dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}
                    `}
                  >
                    <div className={`
                      absolute top-1 w-5 h-5 bg-white dark:bg-gray-900 rounded-full shadow transition-transform duration-200
                      ${localPrefs.quietHoursEnabled ? 'translate-x-6' : 'translate-x-1'}
                    `} />
                  </button>
                </div>

                {localPrefs.quietHoursEnabled && (
                  <div className="flex items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400">De</label>
                      <input
                        type="time"
                        value={localPrefs.quietHoursStart}
                        onChange={(e) => handlePrefChange('quietHoursStart', e.target.value)}
                        className="w-full mt-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400">À</label>
                      <input
                        type="time"
                        value={localPrefs.quietHoursEnd}
                        onChange={(e) => handlePrefChange('quietHoursEnd', e.target.value)}
                        className="w-full mt-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Test notification */}
          {isSubscribed && (
            <div className="px-4 pb-6">
              <button
                onClick={handleTestNotification}
                disabled={testSent}
                className={`
                  w-full py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-2
                  transition-all duration-200
                  ${testSent
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }
                `}
              >
                {testSent ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>Notification envoyée!</span>
                  </>
                ) : (
                  <>
                    <Smartphone className="w-5 h-5" />
                    <span>Envoyer une notification test</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Device info */}
          <div className="px-4 pb-6">
            <div className="text-center text-xs text-gray-400 dark:text-gray-500">
              <p>Appareil: {navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}</p>
              <p className="mt-1">Les notifications sont envoyées via Web Push</p>
            </div>
          </div>
        </div>
      </div>

      {/* Animations */}
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
        .animate-slideUp {
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
}
