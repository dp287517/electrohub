// lib/push-notify.js - Shared Push Notification Utility
// Can be imported by any microservice to send push notifications

import webpush from 'web-push';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// Configure VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@electrohub.io';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Equipment type labels in French
const EQUIPMENT_LABELS = {
  atex: 'ATEX',
  vsd: 'Variateur',
  meca: 'Équipement mécanique',
  hv: 'Haute tension',
  glo: 'GLO',
  mobile: 'Équipement mobile',
  door: 'Porte',
  switchboard: 'Tableau électrique',
  device: 'Appareil'
};

// Get URL for equipment type
function getEquipmentUrl(type, id) {
  const urls = {
    atex: `/app/atex/equipment/${id}`,
    vsd: `/app/vsd/equipment/${id}`,
    meca: `/app/meca/equipment/${id}`,
    hv: `/app/hv/equipment/${id}`,
    glo: `/app/glo/equipment/${id}`,
    mobile: `/app/mobile-equipment/${id}`,
    door: `/app/doors/${id}`,
    switchboard: `/app/switchboard/${id}`,
    device: `/app/switchboard/device/${id}`
  };
  return urls[type] || `/dashboard`;
}

// Send notification to specific users
async function sendToUsers(userIds, notification) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[Push] VAPID not configured, skipping notification');
    return { sent: 0 };
  }

  try {
    const subsResult = await pool.query(`
      SELECT user_id, endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = ANY($1)
    `, [userIds]);

    if (subsResult.rows.length === 0) return { sent: 0 };

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: notification.icon || '/icons/icon-192x192.png',
      badge: notification.badge || '/icons/badge-72x72.png',
      type: notification.type,
      tag: notification.tag || `electrohub-${Date.now()}`,
      data: notification.data || {},
      requireInteraction: notification.requireInteraction || false,
      timestamp: Date.now()
    });

    const results = await Promise.allSettled(
      subsResult.rows.map(async (sub) => {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
          }, payload);
          return { success: true };
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          }
          throw error;
        }
      })
    );

    return { sent: results.filter(r => r.status === 'fulfilled').length };
  } catch (error) {
    console.error('[Push] Send error:', error.message);
    return { sent: 0, error: error.message };
  }
}

// Broadcast to all users except one
async function broadcastExcept(notification, excludeUserId) {
  try {
    const result = await pool.query(
      'SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id != $1',
      [excludeUserId || '']
    );
    const userIds = result.rows.map(r => r.user_id);
    if (userIds.length === 0) return { sent: 0 };
    return sendToUsers(userIds, notification);
  } catch (error) {
    console.error('[Push] Broadcast error:', error.message);
    return { sent: 0 };
  }
}

// Broadcast to all users
async function broadcast(notification) {
  try {
    const result = await pool.query('SELECT DISTINCT user_id FROM push_subscriptions');
    const userIds = result.rows.map(r => r.user_id);
    if (userIds.length === 0) return { sent: 0 };
    return sendToUsers(userIds, notification);
  } catch (error) {
    console.error('[Push] Broadcast error:', error.message);
    return { sent: 0 };
  }
}

// ============================================================
// EQUIPMENT EVENT NOTIFICATIONS
// ============================================================

// Notify when equipment is created
export async function notifyEquipmentCreated(equipmentType, equipment, creatorUserId) {
  const label = EQUIPMENT_LABELS[equipmentType] || equipmentType;
  return broadcastExcept({
    title: `✨ Nouvel équipement créé`,
    body: `${label}: ${equipment.name || equipment.code || 'Sans nom'}`,
    type: 'equipment_created',
    tag: `equipment-created-${equipment.id}`,
    data: {
      equipmentType,
      equipmentId: equipment.id,
      url: getEquipmentUrl(equipmentType, equipment.id)
    }
  }, creatorUserId);
}

// Notify when equipment is deleted
export async function notifyEquipmentDeleted(equipmentType, equipment, deleterUserId) {
  const label = EQUIPMENT_LABELS[equipmentType] || equipmentType;
  return broadcastExcept({
    title: `🗑️ Équipement supprimé`,
    body: `${label}: ${equipment.name || equipment.code || 'Sans nom'}`,
    type: 'equipment_deleted',
    tag: `equipment-deleted-${equipment.id}`,
    data: { equipmentType, equipmentId: equipment.id }
  }, deleterUserId);
}

// Notify when maintenance/control is completed
export async function notifyMaintenanceCompleted(equipmentType, equipment, check, performerUserId) {
  const label = EQUIPMENT_LABELS[equipmentType] || equipmentType;
  const isOk = check.status === 'ok' || check.status === 'conforme' || check.status === 'fait';
  const statusEmoji = isOk ? '✅' : '⚠️';
  const statusText = isOk ? 'Conforme' : 'Non-conforme';

  return broadcastExcept({
    title: `${statusEmoji} Contrôle terminé`,
    body: `${label}: ${equipment.name || equipment.code || 'Équipement'} - ${statusText}`,
    type: 'maintenance_completed',
    tag: `maintenance-${check.id || Date.now()}`,
    requireInteraction: !isOk,
    data: {
      equipmentType,
      equipmentId: equipment.id,
      checkId: check.id,
      status: check.status,
      url: getEquipmentUrl(equipmentType, equipment.id)
    }
  }, performerUserId);
}

// Notify for non-conformity detected
export async function notifyNonConformity(equipmentType, equipment, details) {
  const label = EQUIPMENT_LABELS[equipmentType] || equipmentType;
  return broadcast({
    title: `🚨 Non-conformité détectée`,
    body: `${label}: ${equipment.name || equipment.code || 'Équipement'}${details ? ` - ${details}` : ''}`,
    type: 'non_conformity',
    tag: `nc-${equipment.id}-${Date.now()}`,
    requireInteraction: true,
    data: {
      equipmentType,
      equipmentId: equipment.id,
      url: getEquipmentUrl(equipmentType, equipment.id)
    }
  });
}

// Notify when equipment status changes
export async function notifyStatusChanged(equipmentType, equipment, newStatus, changerUserId) {
  const label = EQUIPMENT_LABELS[equipmentType] || equipmentType;
  const statusEmoji = newStatus === 'conforme' || newStatus === 'ok' ? '✅' :
                      newStatus === 'non_conforme' || newStatus === 'nc' ? '⚠️' : '🔄';

  return broadcastExcept({
    title: `${statusEmoji} Statut modifié`,
    body: `${label}: ${equipment.name || equipment.code || 'Équipement'} → ${newStatus}`,
    type: 'status_changed',
    tag: `status-${equipment.id}`,
    data: {
      equipmentType,
      equipmentId: equipment.id,
      newStatus,
      url: getEquipmentUrl(equipmentType, equipment.id)
    }
  }, changerUserId);
}

// ============================================================
// PROCEDURE EVENT NOTIFICATIONS
// ============================================================

// Notify when a procedure is created
export async function notifyProcedureCreated(procedure, creatorUserId) {
  const riskEmoji = procedure.risk_level === 'critical' ? '🔴' :
                    procedure.risk_level === 'high' ? '🟠' :
                    procedure.risk_level === 'medium' ? '🟡' : '🟢';

  return broadcastExcept({
    title: `📋 Nouvelle procédure créée`,
    body: `${riskEmoji} ${procedure.title || 'Sans titre'}`,
    type: 'procedure_created',
    tag: `procedure-created-${procedure.id}`,
    data: {
      procedureId: procedure.id,
      url: `/app/procedures/${procedure.id}`
    }
  }, creatorUserId);
}

// Notify when a procedure is deleted
export async function notifyProcedureDeleted(procedure, deleterUserId) {
  return broadcastExcept({
    title: `🗑️ Procédure supprimée`,
    body: `${procedure.title || 'Sans titre'}`,
    type: 'procedure_deleted',
    tag: `procedure-deleted-${procedure.id}`,
    data: {
      procedureId: procedure.id
    }
  }, deleterUserId);
}

// Notify when a signature is requested (broadcast to all)
export async function notifyProcedureSignatureRequested(procedure, signerEmail, requesterUserId) {
  return broadcastExcept({
    title: `✍️ Signature en attente`,
    body: `"${procedure.title}" - En attente de signature de ${signerEmail}`,
    type: 'procedure_signature_pending',
    tag: `procedure-signature-pending-${procedure.id}-${Date.now()}`,
    requireInteraction: true,
    data: {
      procedureId: procedure.id,
      signerEmail,
      url: `/app/procedures/${procedure.id}`
    }
  }, requesterUserId);
}

// Notify when a procedure is signed
export async function notifyProcedureSigned(procedure, signerEmail, signerUserId) {
  return broadcastExcept({
    title: `✅ Procédure signée`,
    body: `"${procedure.title}" signée par ${signerEmail}`,
    type: 'procedure_signed',
    tag: `procedure-signed-${procedure.id}-${Date.now()}`,
    data: {
      procedureId: procedure.id,
      signerEmail,
      url: `/app/procedures/${procedure.id}`
    }
  }, signerUserId);
}

// Notify when a procedure status changes
export async function notifyProcedureStatusChanged(procedure, newStatus, changerUserId) {
  const statusEmoji = newStatus === 'approved' || newStatus === 'active' ? '✅' :
                      newStatus === 'draft' ? '📝' :
                      newStatus === 'pending_signature' ? '✍️' :
                      newStatus === 'rejected' ? '❌' : '🔄';
  const statusLabels = {
    draft: 'Brouillon',
    pending_signature: 'En attente de signature',
    approved: 'Approuvée',
    active: 'Active',
    rejected: 'Rejetée',
    archived: 'Archivée'
  };

  return broadcastExcept({
    title: `${statusEmoji} Statut procédure modifié`,
    body: `"${procedure.title}" → ${statusLabels[newStatus] || newStatus}`,
    type: 'procedure_status_changed',
    tag: `procedure-status-${procedure.id}`,
    data: {
      procedureId: procedure.id,
      newStatus,
      url: `/app/procedures/${procedure.id}`
    }
  }, changerUserId);
}

// Generic notification sender
export async function notify(title, body, options = {}) {
  const notification = {
    title,
    body,
    type: options.type || 'info',
    tag: options.tag || `notify-${Date.now()}`,
    requireInteraction: options.requireInteraction || false,
    data: options.data || {}
  };

  if (options.excludeUserId) {
    return broadcastExcept(notification, options.excludeUserId);
  }
  return broadcast(notification);
}

// Send notification to a specific user by email
export async function notifyUser(userEmail, title, body, options = {}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[Push] VAPID not configured, skipping notification');
    return { sent: 0 };
  }

  const notification = {
    title,
    body,
    type: options.type || 'info',
    tag: options.tag || `notify-${Date.now()}`,
    requireInteraction: options.requireInteraction || false,
    data: options.data || {},
    actions: options.actions || []
  };

  try {
    // First, get the user's UUID from their email (check multiple tables)
    let userId = null;

    // Check users table first
    const userResult = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [userEmail]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      // Check haleon_users table
      const haleonResult = await pool.query(
        `SELECT id FROM haleon_users WHERE email = $1`,
        [userEmail]
      );
      if (haleonResult.rows.length > 0) {
        userId = haleonResult.rows[0].id;
      }
    }

    if (!userId) {
      console.log(`[Push] No user found for email ${userEmail}`);
      return { sent: 0 };
    }

    const subsResult = await pool.query(`
      SELECT endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = $1
    `, [userId]);

    if (subsResult.rows.length === 0) {
      console.log(`[Push] No subscription found for ${userEmail}`);
      return { sent: 0 };
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      type: notification.type,
      tag: notification.tag,
      data: notification.data,
      actions: notification.actions,
      requireInteraction: notification.requireInteraction,
      timestamp: Date.now()
    });

    const results = await Promise.allSettled(
      subsResult.rows.map(async (sub) => {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
          }, payload);
          return { success: true };
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          }
          throw error;
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Push] Sent ${sent} notification(s) to ${userEmail}`);
    return { sent };
  } catch (error) {
    console.error('[Push] Send error:', error.message);
    return { sent: 0, error: error.message };
  }
}

// ============================================================
// USER EVENT NOTIFICATIONS
// ============================================================

// Notify admins when a new user is pending validation
export async function notifyNewUserPending(user) {
  // Only notify admins (those with admin role or specific admin emails)
  try {
    // Get admin users from the database
    const adminResult = await pool.query(`
      SELECT DISTINCT ps.user_id
      FROM push_subscriptions ps
      JOIN users u ON ps.user_id::text = u.id::text OR LOWER(ps.user_id) = LOWER(u.email)
      WHERE u.role = 'admin' OR LOWER(u.email) IN (
        SELECT LOWER(email) FROM admin_emails
      )
    `);

    // Fallback: if no admins found via role, try to get from admin_emails table
    let adminUserIds = adminResult.rows.map(r => r.user_id);

    if (adminUserIds.length === 0) {
      // Try to find admins from admin_emails table
      const adminEmailsResult = await pool.query(`
        SELECT ps.user_id
        FROM push_subscriptions ps
        WHERE EXISTS (
          SELECT 1 FROM admin_emails ae
          WHERE LOWER(ps.user_id) = LOWER(ae.email)
        )
      `);
      adminUserIds = adminEmailsResult.rows.map(r => r.user_id);
    }

    if (adminUserIds.length === 0) {
      console.log('[Push] No admin subscriptions found for pending user notification');
      return { sent: 0 };
    }

    const notification = {
      title: `👤 Nouvel utilisateur en attente`,
      body: `${user.name || user.email} attend votre validation`,
      type: 'user_pending',
      tag: `user-pending-${user.email}-${Date.now()}`,
      requireInteraction: true,
      data: {
        userEmail: user.email,
        userName: user.name,
        url: '/admin?tab=pending'
      }
    };

    return sendToUsers(adminUserIds, notification);
  } catch (error) {
    console.error('[Push] Error notifying admins of pending user:', error.message);
    return { sent: 0 };
  }
}

export default {
  notifyEquipmentCreated,
  notifyEquipmentDeleted,
  notifyMaintenanceCompleted,
  notifyNonConformity,
  notifyStatusChanged,
  notifyProcedureCreated,
  notifyProcedureDeleted,
  notifyProcedureSignatureRequested,
  notifyProcedureSigned,
  notifyProcedureStatusChanged,
  notify,
  notifyUser,
  notifyNewUserPending
};
