// ElectroHub Service Worker v1.0
// Push Notifications & Offline Support

const CACHE_NAME = 'electrohub-v1';
const OFFLINE_URL = '/offline.html';

// Assets to cache for offline use
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// ============================================================
// INSTALL EVENT
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// ============================================================
// ACTIVATE EVENT
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ============================================================
// PUSH NOTIFICATION EVENT
// ============================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  let data = {
    title: 'ElectroHub',
    body: 'Nouvelle notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: 'electrohub-notification',
    data: {}
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192x192.png',
    badge: data.badge || '/icons/badge-72x72.png',
    tag: data.tag || 'electrohub-notification',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    renotify: data.renotify || false,
    silent: data.silent || false,
    timestamp: data.timestamp || Date.now()
  };

  // Add specific actions based on notification type
  if (data.type === 'control_due') {
    options.actions = [
      { action: 'view', title: 'Voir', icon: '/icons/view.png' },
      { action: 'snooze', title: 'Reporter', icon: '/icons/snooze.png' }
    ];
    options.requireInteraction = true;
  } else if (data.type === 'alert') {
    options.actions = [
      { action: 'view', title: 'Voir', icon: '/icons/view.png' },
      { action: 'dismiss', title: 'Ignorer', icon: '/icons/dismiss.png' }
    ];
    options.requireInteraction = true;
  } else if (data.type === 'morning_brief') {
    options.actions = [
      { action: 'view', title: 'Consulter', icon: '/icons/view.png' }
    ];
  } else if (data.type === 'pending_user') {
    // Notification for admins when new user needs validation
    options.actions = [
      { action: 'view', title: 'Valider', icon: '/icons/view.png' },
      { action: 'dismiss', title: 'Plus tard', icon: '/icons/dismiss.png' }
    ];
    options.requireInteraction = true;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ============================================================
// NOTIFICATION CLICK EVENT
// ============================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  console.log('[SW] Action:', event.action || 'default');
  console.log('[SW] Notification data:', JSON.stringify(event.notification.data || {}));

  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '/dashboard';

  // Handle different actions
  if (event.action === 'view') {
    targetUrl = data.url || '/dashboard';
    console.log('[SW] View action, URL:', targetUrl);
  } else if (event.action === 'snooze') {
    // Send snooze request to backend
    if (data.controlId) {
      fetch('/api/push/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controlId: data.controlId, hours: 2 })
      }).catch(console.error);
    }
    return;
  } else if (event.action === 'dismiss') {
    return;
  } else {
    // Default click (no specific action) - use data.url if available
    targetUrl = data.url || '/dashboard';
    console.log('[SW] Default action, URL:', targetUrl);
  }

  // Build the full URL
  const fullUrl = new URL(targetUrl, self.location.origin).href;
  console.log('[SW] Navigating to full URL:', fullUrl);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      console.log('[SW] Found', clientList.length, 'window client(s)');

      // Try to focus and navigate existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          console.log('[SW] Found existing window, focusing and navigating...');
          try {
            await client.focus();
            // Use postMessage to tell the client to navigate
            // This is more reliable than client.navigate()
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: targetUrl
            });
            return;
          } catch (e) {
            console.log('[SW] Focus/navigate failed:', e.message);
          }
        }
      }

      // Open new window if no existing window
      console.log('[SW] Opening new window:', fullUrl);
      if (clients.openWindow) {
        return clients.openWindow(fullUrl);
      }
    })
  );
});

// ============================================================
// NOTIFICATION CLOSE EVENT
// ============================================================
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed');
  // Track dismissed notifications if needed
});

// ============================================================
// MESSAGE EVENT (Communication with main app)
// ============================================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ============================================================
// BACKGROUND SYNC (for offline actions)
// ============================================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  try {
    const response = await fetch('/api/push/sync');
    const data = await response.json();
    console.log('[SW] Notifications synced:', data);
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

// ============================================================
// FETCH EVENT (Network-first with cache fallback)
// ============================================================
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls (don't cache)
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone response for cache
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
        });
      })
  );
});

console.log('[SW] Service Worker loaded');
