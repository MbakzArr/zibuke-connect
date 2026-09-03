import { pool } from '../../db/pool';
import { emitToUser } from '../messaging/realtime';

// One place that both stores a notification and pushes it live. Other
// modules (mentions in messaging, announcements) call createNotification;
// they don't touch sockets themselves. If the user is connected, they get
// it instantly; if not, it's waiting in their list when they next load.

type NotificationType = 'mention' | 'announcement' | 'announcement_mention' | 'dm' | 'event' | 'department_head' | 'task_assigned' | 'reaction';

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
  if (n.type === 'announcement' || n.type === 'announcement_mention') {
    const r = await pool.query(
      `SELECT title AS announcement_title FROM announcements WHERE id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  if (n.type === 'event') {
    const r = await pool.query(
      `SELECT title AS event_title, starts_at AS event_starts_at, venue AS event_venue
       FROM events WHERE id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  if (n.type === 'department_head') {
    const r = await pool.query(
      `SELECT name AS department_name FROM departments WHERE id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  if (n.type === 'task_assigned') {
    const r = await pool.query(
      `SELECT title AS task_title, TO_CHAR(due_date, 'YYYY-MM-DD') AS task_due_date FROM tasks WHERE id = $1`,
      [n.source_id]
    );
    return { ...n, ...r.rows[0] };
  }
  if (n.type === 'reaction') {
    // source_id here is the reactions table row's own id, not a message
    // or announcement id - it's the one row that already has everything
    // needed (who reacted, with what emoji, on what) without a schema
    // change. If that reaction was since removed (the person toggled it
    // off), this returns nothing and the notification just shows without
    // a preview - same "source since deleted" handling every other
    // notification type already has. Distinct column names
    // (reaction_message_content, not message_content) deliberately match
    // listNotifications' bulk query below - reusing message_content here
    // would silently collide with the mention/dm join in that query and
    // overwrite a correct value with null for unrelated notification rows.
    const r = await pool.query(
      `SELECT r.emoji AS reaction_emoji, r.target_type AS reaction_target_type,
              reactor.full_name AS reactor_name,
              msg.content AS reaction_message_content,
              ann.title AS reaction_announcement_title
       FROM reactions r
       LEFT JOIN employee_profiles reactor ON reactor.user_id = r.user_id
       LEFT JOIN messages msg ON msg.id = r.target_id AND r.target_type = 'message'
       LEFT JOIN announcements ann ON ann.id = r.target_id AND r.target_type = 'announcement'
       WHERE r.id = $1`,
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
            ann.title          AS announcement_title,
            ev.title           AS event_title,
            ev.starts_at       AS event_starts_at,
            ev.venue           AS event_venue,
            dept.name          AS department_name,
            tsk.title          AS task_title,
            TO_CHAR(tsk.due_date, 'YYYY-MM-DD') AS task_due_date,
            rxn.emoji          AS reaction_emoji,
            rxn.target_type    AS reaction_target_type,
            reactor.full_name  AS reactor_name,
            rxn_msg.content    AS reaction_message_content,
            rxn_ann.title      AS reaction_announcement_title
     FROM notifications n
     LEFT JOIN messages msg
       ON msg.id = n.source_id AND n.type IN ('mention', 'dm')
     LEFT JOIN employee_profiles sender
       ON sender.user_id = msg.user_id
     LEFT JOIN announcements ann
       ON ann.id = n.source_id AND n.type IN ('announcement', 'announcement_mention')
     LEFT JOIN events ev
       ON ev.id = n.source_id AND n.type = 'event'
     LEFT JOIN departments dept
       ON dept.id = n.source_id AND n.type = 'department_head'
     LEFT JOIN tasks tsk
       ON tsk.id = n.source_id AND n.type = 'task_assigned'
     LEFT JOIN reactions rxn
       ON rxn.id = n.source_id AND n.type = 'reaction'
     LEFT JOIN employee_profiles reactor
       ON reactor.user_id = rxn.user_id
     LEFT JOIN messages rxn_msg
       ON rxn_msg.id = rxn.target_id AND rxn.target_type = 'message'
     LEFT JOIN announcements rxn_ann
       ON rxn_ann.id = rxn.target_id AND rxn.target_type = 'announcement'
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

// Mark a user's DM notifications for a specific channel as read. Called when
// they open that DM, so the unread dot doesn't come back on refresh (which
// was happening because clearing it only client-side left the DB unread).
export async function markDmReadForChannel(userId: string, channelId: string) {
  await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE user_id = $1 AND type = 'dm' AND is_read = false
       AND source_id IN (SELECT id FROM messages WHERE channel_id = $2)`,
    [userId, channelId]
  );
  return true;
}
