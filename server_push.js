// server_push.js - Push Notification Server Module
// Handles VAPID keys, subscriptions, and sending push notifications

import express from 'express';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const router = express.Router();

// ============================================================
// VAPID CONFIGURATION
// ============================================================
// Generate VAPID keys once and store in .env
// Run: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@electrohub.io';

// Configure web-push with VAPID details
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[Push] Web-push configured with VAPID keys');
} else {
  console.warn('[Push] VAPID keys not configured. Generate them with: npx web-push generate-vapid-keys');
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'devsecret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
async function initPushTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        user_agent TEXT,
        platform TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_preferences (
        user_id INTEGER PRIMARY KEY,
        control_reminders BOOLEAN DEFAULT TRUE,
        morning_brief BOOLEAN DEFAULT TRUE,
        overdue_alerts BOOLEAN DEFAULT TRUE,
        system_updates BOOLEAN DEFAULT FALSE,
        quiet_hours_enabled BOOLEAN DEFAULT FALSE,
        quiet_hours_start TIME DEFAULT '22:00',
        quiet_hours_end TIME DEFAULT '07:00',
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        type TEXT,
        data JSONB,
        sent_at TIMESTAMP DEFAULT NOW(),
        status TEXT DEFAULT 'sent'
      )
    `);

    console.log('[Push] Database tables initialized');
  } catch (error) {
    console.error('[Push] Failed to initialize tables:', error);
  }
}

// Initialize tables on startup
initPushTables();

// ============================================================
// API ROUTES
// ============================================================

// Get VAPID public key
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID key not configured' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription, userAgent, platform } = req.body;
    const userId = req.user.userId;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }

    // Upsert subscription
    await pool.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, user_agent, platform)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = $1,
        keys_p256dh = $3,
        keys_auth = $4,
        user_agent = $5,
        platform = $6,
        last_used_at = NOW()
    `, [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent, platform]);

    // Initialize preferences if not exists
    await pool.query(`
      INSERT INTO push_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    console.log(`[Push] User ${userId} subscribed`);
    res.json({ success: true, message: 'Subscription saved' });
  } catch (error) {
    console.error('[Push] Subscribe error:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.user.userId;

    await pool.query(`
      DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2
    `, [userId, endpoint]);

    console.log(`[Push] User ${userId} unsubscribed`);
    res.json({ success: true, message: 'Unsubscribed' });
  } catch (error) {
    console.error('[Push] Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Get notification preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT
        control_reminders as "controlReminders",
        morning_brief as "morningBrief",
        overdue_alerts as "overdueAlerts",
        system_updates as "systemUpdates",
        quiet_hours_enabled as "quietHoursEnabled",
        quiet_hours_start as "quietHoursStart",
        quiet_hours_end as "quietHoursEnd"
      FROM push_preferences WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      // Return defaults
      return res.json({
        controlReminders: true,
        morningBrief: true,
        overdueAlerts: true,
        systemUpdates: false,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Push] Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update notification preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      controlReminders,
      morningBrief,
      overdueAlerts,
      systemUpdates,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd
    } = req.body;

    await pool.query(`
      INSERT INTO push_preferences (
        user_id, control_reminders, morning_brief, overdue_alerts,
        system_updates, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        control_reminders = $2,
        morning_brief = $3,
        overdue_alerts = $4,
        system_updates = $5,
        quiet_hours_enabled = $6,
        quiet_hours_start = $7,
        quiet_hours_end = $8,
        updated_at = NOW()
    `, [userId, controlReminders, morningBrief, overdueAlerts,
        systemUpdates, quietHoursEnabled, quietHoursStart, quietHoursEnd]);

    res.json({ success: true });
  } catch (error) {
    console.error('[Push] Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Send test notification
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    const payload = JSON.stringify({
      title: 'Test ElectroHub',
      body: 'Les notifications fonctionnent parfaitement!',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      type: 'test',
      timestamp: Date.now(),
      data: {
        url: '/dashboard'
      }
    });

    // Send to all user's devices
    const results = await Promise.allSettled(
      result.rows.map(sub => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        };
        return webpush.sendNotification(subscription, payload);
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Push] Test notification sent to ${successCount}/${result.rows.length} devices`);

    res.json({ success: true, sent: successCount, total: result.rows.length });
  } catch (error) {
    console.error('[Push] Test notification error:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Snooze a control reminder
router.post('/snooze', async (req, res) => {
  try {
    const { controlId, hours = 2 } = req.body;

    // For now, just acknowledge. In full implementation, would update reminder schedule
    console.log(`[Push] Control ${controlId} snoozed for ${hours} hours`);

    res.json({ success: true, snoozedUntil: new Date(Date.now() + hours * 60 * 60 * 1000) });
  } catch (error) {
    console.error('[Push] Snooze error:', error);
    res.status(500).json({ error: 'Failed to snooze' });
  }
});

// ============================================================
// PUSH NOTIFICATION SENDING UTILITIES
// ============================================================

// Send notification to a specific user
export async function sendNotificationToUser(userId, notification) {
  try {
    // Check user preferences and quiet hours
    const prefsResult = await pool.query(`
      SELECT * FROM push_preferences WHERE user_id = $1
    `, [userId]);

    const prefs = prefsResult.rows[0] || {};

    // Check notification type against preferences
    if (notification.type === 'control' && !prefs.control_reminders) return { sent: 0 };
    if (notification.type === 'morning_brief' && !prefs.morning_brief) return { sent: 0 };
    if (notification.type === 'overdue' && !prefs.overdue_alerts) return { sent: 0 };
    if (notification.type === 'system' && !prefs.system_updates) return { sent: 0 };

    // Check quiet hours
    if (prefs.quiet_hours_enabled) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const start = prefs.quiet_hours_start;
      const end = prefs.quiet_hours_end;

      // Handle overnight quiet hours (e.g., 22:00 to 07:00)
      if (start > end) {
        if (currentTime >= start || currentTime < end) {
          console.log(`[Push] Notification blocked - quiet hours active for user ${userId}`);
          return { sent: 0, reason: 'quiet_hours' };
        }
      } else {
        if (currentTime >= start && currentTime < end) {
          console.log(`[Push] Notification blocked - quiet hours active for user ${userId}`);
          return { sent: 0, reason: 'quiet_hours' };
        }
      }
    }

    // Get all user subscriptions
    const subsResult = await pool.query(`
      SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = $1
    `, [userId]);

    if (subsResult.rows.length === 0) {
      return { sent: 0, reason: 'no_subscriptions' };
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: notification.icon || '/icons/icon-192x192.png',
      badge: notification.badge || '/icons/badge-72x72.png',
      type: notification.type,
      tag: notification.tag || `electrohub-${Date.now()}`,
      data: notification.data || {},
      requireInteraction: notification.requireInteraction || false,
      actions: notification.actions || [],
      timestamp: Date.now()
    });

    // Send to all devices
    const results = await Promise.allSettled(
      subsResult.rows.map(async (sub) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        };
        try {
          await webpush.sendNotification(subscription, payload);
          return { success: true };
        } catch (error) {
          // Remove invalid subscriptions
          if (error.statusCode === 404 || error.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
            console.log(`[Push] Removed invalid subscription: ${sub.endpoint.substring(0, 50)}...`);
          }
          throw error;
        }
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;

    // Log to history
    await pool.query(`
      INSERT INTO push_history (user_id, title, body, type, data)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, notification.title, notification.body, notification.type, notification.data || {}]);

    return { sent: successCount, total: subsResult.rows.length };
  } catch (error) {
    console.error(`[Push] Error sending to user ${userId}:`, error);
    return { sent: 0, error: error.message };
  }
}

// Send notification to multiple users
export async function sendNotificationToUsers(userIds, notification) {
  const results = await Promise.allSettled(
    userIds.map(userId => sendNotificationToUser(userId, notification))
  );

  return {
    total: userIds.length,
    sent: results.filter(r => r.status === 'fulfilled' && r.value.sent > 0).length
  };
}

// Send notification to all users (broadcast)
export async function broadcastNotification(notification) {
  try {
    const result = await pool.query('SELECT DISTINCT user_id FROM push_subscriptions');
    const userIds = result.rows.map(r => r.user_id);
    return sendNotificationToUsers(userIds, notification);
  } catch (error) {
    console.error('[Push] Broadcast error:', error);
    return { sent: 0, error: error.message };
  }
}

// Send control reminder notification
export async function sendControlReminder(userId, control) {
  return sendNotificationToUser(userId, {
    title: `Contrôle à faire`,
    body: `${control.name} - ${control.building || 'Bâtiment'} ${control.floor || ''}`.trim(),
    type: 'control_due',
    tag: `control-${control.id}`,
    requireInteraction: true,
    data: {
      controlId: control.id,
      url: `/app/switchboard-controls?id=${control.id}`
    },
    actions: [
      { action: 'view', title: 'Voir' },
      { action: 'snooze', title: 'Reporter 2h' }
    ]
  });
}

// Send overdue alert
export async function sendOverdueAlert(userId, overdueCount) {
  return sendNotificationToUser(userId, {
    title: `${overdueCount} contrôle${overdueCount > 1 ? 's' : ''} en retard`,
    body: 'Des contrôles nécessitent votre attention urgente',
    type: 'alert',
    tag: 'overdue-alert',
    requireInteraction: true,
    data: {
      url: '/app/switchboard-controls?filter=overdue'
    }
  });
}

// Send morning brief notification
export async function sendMorningBrief(userId, brief) {
  return sendNotificationToUser(userId, {
    title: brief.greeting || 'Bonjour!',
    body: brief.summary || 'Consultez votre brief du jour',
    type: 'morning_brief',
    tag: 'morning-brief',
    data: {
      url: '/dashboard',
      healthScore: brief.healthScore
    }
  });
}

export default router;
