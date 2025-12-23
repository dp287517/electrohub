// NotificationProvider.jsx
// Context provider for push notifications - Uber-style design
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { pushNotifications } from '../../lib/push-notifications';
import NotificationPermissionModal from './NotificationPermissionModal';
import NotificationToast from './NotificationToast';

const NotificationContext = createContext(null);

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}

export default function NotificationProvider({ children }) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [preferences, setPreferences] = useState({
    controlReminders: true,
    morningBrief: true,
    overdueAlerts: true,
    systemUpdates: false,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00'
  });

  // Initialize push notification service
  useEffect(() => {
    const init = async () => {
      console.log('[Notifications] Initializing...');
      const supported = pushNotifications.isSupported;
      setIsSupported(supported);
      console.log('[Notifications] Supported:', supported);

      if (supported) {
        const perm = pushNotifications.getPermissionStatus();
        setPermission(perm);
        console.log('[Notifications] Permission:', perm);

        await pushNotifications.registerServiceWorker();
        const subscription = await pushNotifications.getSubscription();
        setIsSubscribed(!!subscription);
        console.log('[Notifications] Subscribed:', !!subscription);

        // Load preferences
        try {
          const prefs = await pushNotifications.getPreferences();
          if (prefs) {
            setPreferences(prev => ({ ...prev, ...prefs }));
          }
        } catch (e) {
          console.log('[Notifications] Could not load preferences');
        }
      }
      setIsInitialized(true);
    };

    init();
  }, []);

  // Check if we should prompt for notifications
  useEffect(() => {
    if (!isInitialized) return;

    const shouldPrompt = () => {
      // Must be supported
      if (!isSupported) {
        console.log('[Notifications] Not prompting: not supported');
        return false;
      }

      // Already subscribed? No need to prompt
      if (isSubscribed) {
        console.log('[Notifications] Not prompting: already subscribed');
        return false;
      }

      // If permission is denied, don't auto-prompt (user can still click bell)
      if (permission === 'denied') {
        console.log('[Notifications] Not prompting: permission denied');
        return false;
      }

      // Check if user has dismissed recently (only 1 day cooldown now)
      const lastDismissed = localStorage.getItem('eh_notification_prompt_dismissed');
      if (lastDismissed) {
        const dismissedDate = new Date(lastDismissed);
        const hoursSince = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          console.log('[Notifications] Not prompting: dismissed', Math.round(hoursSince), 'hours ago');
          return false;
        }
      }

      // Must be logged in
      const token = localStorage.getItem('eh_token');
      if (!token) {
        console.log('[Notifications] Not prompting: not logged in');
        return false;
      }

      console.log('[Notifications] Will prompt for notifications');
      return true;
    };

    // Delay the prompt for better UX
    const timer = setTimeout(() => {
      if (shouldPrompt()) {
        setShowPermissionModal(true);
      }
    }, 3000); // Show after 3 seconds

    return () => clearTimeout(timer);
  }, [isInitialized, isSupported, permission, isSubscribed]);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    const permResult = await pushNotifications.requestPermission();
    setPermission(pushNotifications.getPermissionStatus());

    if (permResult.success) {
      const subResult = await pushNotifications.subscribe();
      setIsSubscribed(subResult.success);
      return subResult;
    }

    return permResult;
  }, []);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    const result = await pushNotifications.unsubscribe();
    if (result.success) {
      setIsSubscribed(false);
    }
    return result;
  }, []);

  // Update notification preferences
  const updatePreferences = useCallback(async (newPrefs) => {
    const updatedPrefs = { ...preferences, ...newPrefs };
    setPreferences(updatedPrefs);
    await pushNotifications.updatePreferences(updatedPrefs);
  }, [preferences]);

  // Show a toast notification
  const showToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    const newToast = {
      id,
      type: 'info',
      duration: 5000,
      ...toast
    };

    setToasts(prev => [...prev, newToast]);

    // Auto remove
    if (newToast.duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, newToast.duration);
    }

    return id;
  }, []);

  // Remove a toast
  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Convenience methods for different toast types
  const toast = {
    success: (title, message, options) => showToast({ type: 'success', title, message, ...options }),
    error: (title, message, options) => showToast({ type: 'error', title, message, ...options }),
    warning: (title, message, options) => showToast({ type: 'warning', title, message, ...options }),
    info: (title, message, options) => showToast({ type: 'info', title, message, ...options }),
    control: (title, message, options) => showToast({ type: 'control', title, message, ...options })
  };

  // Handle permission modal actions
  const handlePermissionAllow = async () => {
    const result = await subscribe();
    setShowPermissionModal(false);

    if (result.success) {
      toast.success('Notifications activées', 'Vous recevrez des alertes pour vos contrôles');
    } else {
      toast.error('Erreur', 'Impossible d\'activer les notifications');
    }
  };

  const handlePermissionDismiss = () => {
    localStorage.setItem('eh_notification_prompt_dismissed', new Date().toISOString());
    setShowPermissionModal(false);
  };

  // Reset dismissed state and show modal
  const promptForNotifications = useCallback(() => {
    localStorage.removeItem('eh_notification_prompt_dismissed');
    setShowPermissionModal(true);
  }, []);

  const value = {
    isSupported,
    permission,
    isSubscribed,
    preferences,
    subscribe,
    unsubscribe,
    updatePreferences,
    showPermissionModal: promptForNotifications,
    toast,
    sendTestNotification: pushNotifications.sendTestNotification.bind(pushNotifications)
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}

      {/* Permission Modal */}
      <NotificationPermissionModal
        isOpen={showPermissionModal}
        onAllow={handlePermissionAllow}
        onDismiss={handlePermissionDismiss}
      />

      {/* Toast Container */}
      <div className="fixed bottom-0 right-0 z-[9999] p-4 space-y-3 pointer-events-none max-w-md w-full sm:p-6">
        {toasts.map(t => (
          <NotificationToast
            key={t.id}
            {...t}
            onClose={() => removeToast(t.id)}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
