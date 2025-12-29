// ElectroHub Push Notification Service
// Handles service worker registration, subscription management, and push notifications

class PushNotificationService {
  constructor() {
    this.swRegistration = null;
    this.subscription = null;
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
  }

  // ============================================================
  // SERVICE WORKER REGISTRATION
  // ============================================================
  async registerServiceWorker() {
    if (!this.isSupported) {
      console.log('[Push] Service workers not supported');
      return null;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('[Push] Service Worker registered:', this.swRegistration);

      // Handle updates
      this.swRegistration.addEventListener('updatefound', () => {
        const newWorker = this.swRegistration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            this.onUpdateAvailable?.();
          }
        });
      });

      // Listen for messages from service worker (e.g., notification clicks)
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('[Push] Message from SW:', event.data);
        if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
          console.log('[Push] Navigating to:', event.data.url);
          // Use the router to navigate - this triggers properly in React
          window.location.href = event.data.url;
        }
      });

      return this.swRegistration;
    } catch (error) {
      console.error('[Push] Service Worker registration failed:', error);
      return null;
    }
  }

  // ============================================================
  // PERMISSION STATUS
  // ============================================================
  getPermissionStatus() {
    if (!this.isSupported) return 'unsupported';
    return Notification.permission; // 'granted', 'denied', 'default'
  }

  isPushEnabled() {
    return this.getPermissionStatus() === 'granted' && this.subscription !== null;
  }

  // ============================================================
  // REQUEST PERMISSION & SUBSCRIBE
  // ============================================================
  async requestPermission() {
    if (!this.isSupported) {
      return { success: false, error: 'Push notifications not supported' };
    }

    try {
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        return { success: false, error: 'Permission denied', permission };
      }

      return { success: true, permission };
    } catch (error) {
      console.error('[Push] Permission request failed:', error);
      return { success: false, error: error.message };
    }
  }

  async subscribe() {
    if (!this.swRegistration) {
      await this.registerServiceWorker();
    }

    if (!this.swRegistration) {
      return { success: false, error: 'Service Worker not registered' };
    }

    try {
      // Get VAPID public key from server
      const response = await fetch('/api/push/vapid-public-key');
      const { publicKey } = await response.json();

      if (!publicKey) {
        return { success: false, error: 'VAPID key not available' };
      }

      // Subscribe to push
      this.subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(publicKey)
      });

      // Send subscription to server
      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('eh_token')}`
        },
        body: JSON.stringify({
          subscription: this.subscription.toJSON(),
          userAgent: navigator.userAgent,
          platform: this.detectPlatform()
        })
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save subscription');
      }

      console.log('[Push] Subscription saved:', this.subscription);
      return { success: true, subscription: this.subscription };
    } catch (error) {
      console.error('[Push] Subscription failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // UNSUBSCRIBE
  // ============================================================
  async unsubscribe() {
    if (!this.subscription) {
      // Try to get existing subscription
      if (this.swRegistration) {
        this.subscription = await this.swRegistration.pushManager.getSubscription();
      }
    }

    if (!this.subscription) {
      return { success: true, message: 'No active subscription' };
    }

    try {
      // Unsubscribe from push
      await this.subscription.unsubscribe();

      // Remove from server
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('eh_token')}`
        },
        body: JSON.stringify({
          endpoint: this.subscription.endpoint
        })
      });

      this.subscription = null;
      console.log('[Push] Unsubscribed successfully');
      return { success: true };
    } catch (error) {
      console.error('[Push] Unsubscribe failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // GET CURRENT SUBSCRIPTION
  // ============================================================
  async getSubscription() {
    if (!this.swRegistration) {
      await this.registerServiceWorker();
    }

    if (!this.swRegistration) return null;

    this.subscription = await this.swRegistration.pushManager.getSubscription();
    return this.subscription;
  }

  // ============================================================
  // NOTIFICATION PREFERENCES
  // ============================================================
  async updatePreferences(preferences) {
    try {
      const response = await fetch('/api/push/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('eh_token')}`
        },
        body: JSON.stringify(preferences)
      });

      if (!response.ok) throw new Error('Failed to update preferences');

      return { success: true };
    } catch (error) {
      console.error('[Push] Preferences update failed:', error);
      return { success: false, error: error.message };
    }
  }

  async getPreferences() {
    try {
      const response = await fetch('/api/push/preferences', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('eh_token')}`
        }
      });

      if (!response.ok) throw new Error('Failed to get preferences');

      return await response.json();
    } catch (error) {
      console.error('[Push] Get preferences failed:', error);
      return null;
    }
  }

  // ============================================================
  // TEST NOTIFICATION
  // ============================================================
  async sendTestNotification() {
    try {
      const response = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('eh_token')}`
        }
      });

      if (!response.ok) throw new Error('Failed to send test notification');

      return { success: true };
    } catch (error) {
      console.error('[Push] Test notification failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // LOCAL NOTIFICATION (for in-app use)
  // ============================================================
  async showLocalNotification(title, options = {}) {
    if (!this.swRegistration) {
      await this.registerServiceWorker();
    }

    if (!this.swRegistration || Notification.permission !== 'granted') {
      return null;
    }

    return this.swRegistration.showNotification(title, {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      vibrate: [100, 50, 100],
      ...options
    });
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  detectPlatform() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    return 'unknown';
  }

  // Check if running as installed PWA
  isInstalledPWA() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }
}

// Export singleton
export const pushNotifications = new PushNotificationService();
export default pushNotifications;
