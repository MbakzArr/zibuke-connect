import { pool } from '../../db/pool';
import { emitToUser } from '../messaging/realtime';

// One place that both stores a notification and pushes it live. Other
// modules (mentions in messaging, announcements) call createNotification;
// they don't touch sockets themselves. If the user is connected, they get
// it instantly; if not, it's waiting in their list when they next load.

type NotificationType = 'mention' | 'announcement' | 'dm';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  sourceId: string; // id of the message / announcement that caused it
}

export async function createNotification(input: CreateNotificationInput) {
  const { userId, type, sourceId } = input;

  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, source_id)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, type, source_id, is_read, created_at`,
    [userId, type, sourceId]
  );
  const notification = result.rows[0];

  // Push it live. If the user has no open socket this is a no-op and the
  // notification simply waits in the database.
  emitToUser(userId, 'notification:new', notification);

  return notification;
}

// Bulk create for announcements that target many people at once. One INSERT
// instead of a loop, then a live push to each. This is what keeps an
// org-wide announcement from firing thousands of separate INSERTs.
export async function createNotificationsForMany(
  userIds: string[],
  type: NotificationType,
  sourceId: string
) {
  if (userIds.length === 0) return [];

  // Build a multi-row VALUES list: ($1,$4,$5), ($2,$4,$5), ...
  const valuePlaceholders = userIds
    .map((_, i) => `($${i + 1}, $${userIds.length + 1}, $${userIds.length + 2})`)
    .join(', ');

  const params = [...userIds, type, sourceId];

  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, source_id)
     VALUES ${valuePlaceholders}
     RETURNING id, user_id, type, source_id, is_read, created_at`,
    params
  );

  for (const notification of result.rows) {
    emitToUser(notification.user_id, 'notification:new', notification);
  }

  return result.rows;
}

export async function listNotifications(userId: string, unreadOnly = false) {
  const result = await pool.query(
    `SELECT id, user_id, type, source_id, is_read, created_at
     FROM notifications
     WHERE user_id = $1
       ${unreadOnly ? 'AND is_read = false' : ''}
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return result.rows;
}

export async function markRead(userId: string, notificationId: string) {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [notificationId, userId]
  );
  return result.rows.length > 0;
}

export async function markAllRead(userId: string) {
  await pool.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  return true;
}
