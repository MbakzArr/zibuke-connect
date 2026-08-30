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
  return result.rows[0];
}

export async function deleteMessage(messageId: string, userId: string) {
  const existing = await getMessageById(messageId);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }
  if (existing.user_id !== userId) {
    throw new Error('NOT_AUTHOR');
  }

  // Soft delete: keep the row, stamp deleted_at, blank the content. The row
  // stays so message history stays consistent and an audit trail exists.
  const result = await pool.query(
    `UPDATE messages
     SET deleted_at = now(), content = ''
     WHERE id = $1 AND user_id = $2
     RETURNING id, channel_id, user_id, content, created_at, edited_at, deleted_at`,
    [messageId, userId]
  );
  return maskIfDeleted(result.rows[0]);
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
// results are meaningful without extra lookups.
export async function searchMessages(userId: string, query: string, limit = 30) {
  const like = `%${query}%`;
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
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [userId, like, limit]
  );
  return result.rows;
}
