import { pool } from '../../db/pool';

// Data layer for messages. Every read/write here assumes the caller has
// already been confirmed as a member of the channel, that membership check
// lives in the controller and the socket layer, not here, so this stays a
// clean data module.

interface CreateMessageInput {
  channelId: string;
  userId: string;
  content: string;
}

export async function createMessage(input: CreateMessageInput) {
  const { channelId, userId, content } = input;

  const result = await pool.query(
    `INSERT INTO messages (channel_id, user_id, content)
     VALUES ($1, $2, $3)
     RETURNING id, channel_id, user_id, content, created_at, edited_at, deleted_at`,
    [channelId, userId, content]
  );

  // Return the message joined with the sender's display name, so the client
  // can render it without a second lookup.
  const message = result.rows[0];
  const sender = await pool.query(
    `SELECT p.full_name FROM employee_profiles p WHERE p.user_id = $1`,
    [userId]
  );
  message.sender_name = sender.rows[0]?.full_name || null;
  return message;
}

// Paginated history, newest first, using keyset pagination on created_at.
// The client passes the created_at of the oldest message it already has as
// `before`, and gets the next older page. This scales far better than
// OFFSET on a large messages table, which is what a 300k-user system needs.
export async function getMessages(channelId: string, limit = 30, before?: string) {
  const params: any[] = [channelId];
  let beforeClause = '';

  if (before) {
    params.push(before);
    beforeClause = `AND m.created_at < $${params.length}`;
  }

  params.push(limit);

  const result = await pool.query(
    `SELECT m.id, m.channel_id, m.user_id, m.content,
            m.created_at, m.edited_at, m.deleted_at,
            p.full_name AS sender_name
     FROM messages m
     LEFT JOIN employee_profiles p ON p.user_id = m.user_id
     WHERE m.channel_id = $1
       ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  // Deleted messages are kept in the table (for audit) but their content is
  // masked in the response rather than shown.
  return result.rows.map(maskIfDeleted);
}

export async function getMessageById(messageId: string) {
  const result = await pool.query(
    `SELECT id, channel_id, user_id, content, created_at, edited_at, deleted_at
     FROM messages WHERE id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function editMessage(messageId: string, userId: string, content: string) {
  const existing = await getMessageById(messageId);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }
  // Only the author can edit their own message.
  if (existing.user_id !== userId) {
    throw new Error('NOT_AUTHOR');
  }
  if (existing.deleted_at) {
    throw new Error('ALREADY_DELETED');
  }

  const result = await pool.query(
    `UPDATE messages
     SET content = $3, edited_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, channel_id, user_id, content, created_at, edited_at, deleted_at`,
    [messageId, userId, content]
  );
  const message = result.rows[0];
  // Attach the sender's name so the client renders the author, not "Unknown".
  const sender = await pool.query(
    'SELECT full_name FROM employee_profiles WHERE user_id = $1',
    [message.user_id]
  );
  message.sender_name = sender.rows[0]?.full_name || null;
  return message;
}

export async function deleteMessage(messageId: string, userId: string) {
  const existing = await getMessageById(messageId);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }
  if (existing.user_id !== userId) {
    throw new Error('NOT_AUTHOR');
  }

  // Soft delete: keep the row AND the real content, just stamp deleted_at.
  // The content stays in the database (masked out of every response by
  // maskIfDeleted below) specifically so a delete can be undone - blanking
  // it here would make "undo" impossible since the original text would
  // already be gone.
  const result = await pool.query(
    `UPDATE messages
     SET deleted_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, channel_id, user_id, content, created_at, edited_at, deleted_at`,
    [messageId, userId]
  );
  const message = maskIfDeleted(result.rows[0]);
  // Keep the sender's name on the deleted stub so history stays consistent
  // (author still shown above the "[message deleted]" placeholder).
  const sender = await pool.query(
    'SELECT full_name FROM employee_profiles WHERE user_id = $1',
    [message.user_id]
  );
  message.sender_name = sender.rows[0]?.full_name || null;
  return message;
}

// Undo a delete: only within a short window, and only the original
// author. Anyone could otherwise "undo" a delete on an old message days
// later, which isn't what Undo means here - it's a mistake-correction
// window, not a permanent restore tool.
const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export async function restoreMessage(messageId: string, userId: string) {
  const existing = await getMessageById(messageId);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }
  if (existing.user_id !== userId) {
    throw new Error('NOT_AUTHOR');
  }
  if (!existing.deleted_at) {
    throw new Error('NOT_DELETED');
  }
  if (Date.now() - new Date(existing.deleted_at).getTime() > UNDO_WINDOW_MS) {
    throw new Error('UNDO_EXPIRED');
  }

  const result = await pool.query(
    `UPDATE messages
     SET deleted_at = NULL
     WHERE id = $1 AND user_id = $2
     RETURNING id, channel_id, user_id, content, created_at, edited_at, deleted_at`,
    [messageId, userId]
  );
  const message = result.rows[0];
  const sender = await pool.query(
    'SELECT full_name FROM employee_profiles WHERE user_id = $1',
    [message.user_id]
  );
  message.sender_name = sender.rows[0]?.full_name || null;
  return message;
}

function maskIfDeleted(message: any) {
  if (message && message.deleted_at) {
    message.content = '[message deleted]';
  }
  return message;
}

// Full-text-ish search over messages the user can actually see: only
// channels they're a member of, case-insensitive substring match. Excludes
// deleted messages. Returns the message plus its channel name and sender so
// results are meaningful without extra lookups. When channelId is given, the
// search is scoped to just that one channel (in-channel search); the
// membership JOIN still applies, so scoping can't be used to reach a channel
// you're not in.
export async function searchMessages(
  userId: string,
  query: string,
  limit = 30,
  channelId?: string
) {
  const like = `%${query}%`;
  const params: any[] = [userId, like];
  let channelFilter = '';
  if (channelId) {
    params.push(channelId);
    channelFilter = `AND m.channel_id = $${params.length}`;
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

  const result = await pool.query(
    `SELECT m.id, m.channel_id, m.user_id, m.content, m.created_at,
            c.name AS channel_name, c.is_dm,
            p.full_name AS sender_name
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
     LEFT JOIN employee_profiles p ON p.user_id = m.user_id
     WHERE m.deleted_at IS NULL
       AND m.content ILIKE $2
       ${channelFilter}
     ORDER BY m.created_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows;
}

// The most recently active conversations (channels + DMs) the user belongs
// to, each resolved to its latest message. Powers the hub's "Recent chats"
// card. For a DM, resolves to the OTHER person's name rather than the
// internal channel name. Real data only - no mocking.
export async function getRecentConversations(userId: string, limit = 6) {
  const result = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (m.channel_id)
              m.channel_id, m.content, m.created_at, m.user_id AS sender_id
       FROM messages m
       JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
       WHERE m.deleted_at IS NULL
       ORDER BY m.channel_id, m.created_at DESC
     )
     SELECT l.channel_id, l.content, l.created_at,
            c.name AS channel_name, c.is_dm,
            sender.full_name AS sender_name,
            otherp.full_name AS other_name
     FROM latest l
     JOIN channels c ON c.id = l.channel_id
     LEFT JOIN employee_profiles sender ON sender.user_id = l.sender_id
     LEFT JOIN channel_members otherm
       ON otherm.channel_id = l.channel_id AND otherm.user_id <> $1 AND c.is_dm = true
     LEFT JOIN users otheru ON otheru.id = otherm.user_id
     LEFT JOIN employee_profiles otherp ON otherp.user_id = otheru.id
     ORDER BY l.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}
