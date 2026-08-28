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

  // Enrich the live payload with source detail so the bell shows a real
  // preview immediately, matching what the list endpoint returns on reload.
  const enriched = await hydrateOne(notification);

  // Push it live. If the user has no open socket this is a no-op and the
  // notification simply waits in the database.
  emitToUser(userId, 'notification:new', enriched);

  return enriched;
}

// Attach source detail (message content + sender + channel, or announcement
// title) to a single notification row.
async function hydrateOne(n: any) {
  if (n.type === 'mention' || n.type === 'dm') {
    const r = await pool.query(
      `SELECT msg.content AS message_content,
              msg.channel_id AS message_channel_id,
              p.full_name AS sender_name
       FROM messages msg
       LEFT JOIN employee_profiles p ON p.user_id = msg.user_id
       WHERE msg.id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  if (n.type === 'announcement') {
    const r = await pool.query(
      `SELECT title AS announcement_title FROM announcements WHERE id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  return n;
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
  // Join each notification to its source so the client can show a real
  // preview and know where to navigate. Mentions and DMs resolve to the
  // message (content, channel, sender); announcements resolve to the title.
  // LEFT JOINs so a notification still returns even if its source was since
  // deleted.
  const result = await pool.query(
    `SELECT n.id, n.user_id, n.type, n.source_id, n.is_read, n.created_at,
            msg.content        AS message_content,
            msg.channel_id     AS message_channel_id,
            sender.full_name   AS sender_name,
            ann.title          AS announcement_title
     FROM notifications n
     LEFT JOIN messages msg
       ON msg.id = n.source_id AND n.type IN ('mention', 'dm')
     LEFT JOIN employee_profiles sender
       ON sender.user_id = msg.user_id
     LEFT JOIN announcements ann
       ON ann.id = n.source_id AND n.type = 'announcement'
     WHERE n.user_id = $1
       ${unreadOnly ? 'AND n.is_read = false' : ''}
     ORDER BY n.created_at DESC
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
