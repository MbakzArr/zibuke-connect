import { pool } from '../../db/pool';

// A direct message is not a separate concept in this system, it's just a
// private channel with is_dm = true and exactly two members. That means
// one set of tables (channels + channel_members) and one set of queries
// serve both group channels and 1-to-1 DMs. Fewer moving parts to explain.

interface CreateChannelInput {
  organizationId: string;
  name: string;
  createdBy: string;
  departmentId?: string | null;
  isPrivate?: boolean;
}

// List the channels a user can see: every public channel in their org,
// plus any private channel they're actually a member of. DMs are excluded
// here, they're fetched separately so the channel list stays clean.
export async function listChannelsForUser(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.department_id, c.is_private, c.created_by, c.created_at,
            (SELECT COUNT(*) FROM channel_members cm2 WHERE cm2.channel_id = c.id) AS member_count
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND (c.is_private = false OR cm.user_id IS NOT NULL)
     ORDER BY c.name ASC`,
    [organizationId, userId]
  );
  return result.rows;
}

export async function getChannel(organizationId: string, channelId: string) {
  const result = await pool.query(
    `SELECT id, name, department_id, is_private, is_dm, created_by, created_at
     FROM channels
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, channelId]
  );
  return result.rows[0] || null;
}

export async function isMember(channelId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  return result.rows.length > 0;
}

export async function createChannel(input: CreateChannelInput) {
  const { organizationId, name, createdBy, departmentId, isPrivate } = input;

  // If the channel is tied to a department, confirm that department is in
  // the same org, so you can't attach a channel to another org's department.
  if (departmentId) {
    const dept = await pool.query(
      'SELECT id FROM departments WHERE id = $1 AND organization_id = $2',
      [departmentId, organizationId]
    );
    if (dept.rows.length === 0) {
      throw new Error('DEPARTMENT_NOT_IN_ORG');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const channelResult = await client.query(
      `INSERT INTO channels (organization_id, department_id, name, is_private, is_dm, created_by)
       VALUES ($1, $2, $3, $4, false, $5)
       RETURNING id, name, department_id, is_private, is_dm, created_by, created_at`,
      [organizationId, departmentId || null, name, isPrivate || false, createdBy]
    );
    const channel = channelResult.rows[0];

    // The creator is automatically the first member.
    await client.query(
      'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)',
      [channel.id, createdBy]
    );

    await client.query('COMMIT');
    return channel;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function joinChannel(organizationId: string, channelId: string, userId: string) {
  const channel = await getChannel(organizationId, channelId);
  if (!channel) {
    throw new Error('NOT_FOUND');
  }
  // You can't self-join a private channel or a DM, those are invite-only.
  if (channel.is_private || channel.is_dm) {
    throw new Error('CANNOT_SELF_JOIN');
  }

  // ON CONFLICT DO NOTHING makes re-joining harmless instead of an error.
  await pool.query(
    `INSERT INTO channel_members (channel_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (channel_id, user_id) DO NOTHING`,
    [channelId, userId]
  );
  return true;
}

export async function leaveChannel(channelId: string, userId: string) {
  await pool.query(
    'DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  return true;
}

export async function listMembers(channelId: string) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.status, p.full_name, p.job_title, cm.joined_at
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     WHERE cm.channel_id = $1
     ORDER BY p.full_name ASC`,
    [channelId]
  );
  return result.rows;
}

// Find an existing 1-to-1 DM channel between two users, or create one.
// This is what makes "message this person" work without a separate DM table.
export async function getOrCreateDm(organizationId: string, userA: string, userB: string) {
  // Self-DM ("notes to self") is allowed: a DM channel with just you in it.
  const isSelf = userA === userB;

  // Confirm the other user is in the same org (for self, that's just userA).
  const other = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
    [userB, organizationId]
  );
  if (other.rows.length === 0) {
    throw new Error('USER_NOT_IN_ORG');
  }

  // Find an existing DM. For a self-DM it's a is_dm channel whose only member
  // is userA; for a normal DM it's the channel with exactly these two members.
  let existing;
  if (isSelf) {
    existing = await pool.query(
      `SELECT c.id
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE c.organization_id = $1 AND c.is_dm = true
       GROUP BY c.id
       HAVING COUNT(*) = 1 AND bool_or(cm.user_id = $2) = true`,
      [organizationId, userA]
    );
  } else {
    existing = await pool.query(
      `SELECT c.id
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE c.organization_id = $1 AND c.is_dm = true
       GROUP BY c.id
       HAVING COUNT(*) = 2
          AND bool_or(cm.user_id = $2) = true
          AND bool_or(cm.user_id = $3) = true`,
      [organizationId, userA, userB]
    );
  }

  if (existing.rows.length > 0) {
    return getChannel(organizationId, existing.rows[0].id);
  }

  const sortedName = isSelf ? `self:${userA}` : [userA, userB].sort().join(':');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const channelResult = await client.query(
      `INSERT INTO channels (organization_id, name, is_private, is_dm, created_by)
       VALUES ($1, $2, true, true, $3)
       RETURNING id, name, department_id, is_private, is_dm, created_by, created_at`,
      [organizationId, `dm:${sortedName}`, userA]
    );
    const channel = channelResult.rows[0];

    if (isSelf) {
      await client.query(
        'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)',
        [channel.id, userA]
      );
    } else {
      await client.query(
        'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)',
        [channel.id, userA, userB]
      );
    }

    await client.query('COMMIT');
    return channel;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// List a user's direct-message channels, each resolved to the OTHER
// participant (name, id, presence) so the UI can show "DM with Thabo"
// instead of the internal channel row. DMs are excluded from the normal
// channel list on purpose; this is their dedicated lookup.
export async function listDmsForUser(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT c.id AS channel_id,
            other.id AS user_id,
            p.full_name,
            other.status,
            p.job_title
     FROM channels c
     JOIN channel_members me ON me.channel_id = c.id AND me.user_id = $2
     JOIN channel_members them ON them.channel_id = c.id AND them.user_id <> $2
     JOIN users other ON other.id = them.user_id
     LEFT JOIN employee_profiles p ON p.user_id = other.id
     WHERE c.organization_id = $1 AND c.is_dm = true
     ORDER BY p.full_name ASC`,
    [organizationId, userId]
  );
  return result.rows;
}

// For a DM channel, return the id of the OTHER member (not the sender).
// Returns null if the channel isn't a DM or has no other member.
export async function getDmRecipient(channelId: string, senderId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT them.user_id
     FROM channels c
     JOIN channel_members them ON them.channel_id = c.id AND them.user_id <> $2
     WHERE c.id = $1 AND c.is_dm = true
     LIMIT 1`,
    [channelId, senderId]
  );
  return result.rows[0]?.user_id || null;
}

// All public channels in the org, each flagged with whether the current user
// is already a member. Powers the "browse channels" view so people can find
// and join channels they're not in yet. Private channels and DMs are never
// listed here.
export async function listBrowsableChannels(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.department_id, c.is_private, c.created_at,
            (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) AS member_count,
            EXISTS (
              SELECT 1 FROM channel_members me
              WHERE me.channel_id = c.id AND me.user_id = $2
            ) AS is_member
     FROM channels c
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND c.is_private = false
     ORDER BY c.name ASC`,
    [organizationId, userId]
  );
  return result.rows;
}

// Search the channels and DMs a user can navigate to, by name. Returns
// public channels (joinable), channels they're in, and DMs matched by the
// other person's name. Powers "jump to a place" in global search.
export async function searchChannelsAndDms(organizationId: string, userId: string, query: string) {
  const like = `%${query}%`;

  // Channels: public ones, plus private ones the user is a member of, name match.
  const channels = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.is_private, c.is_dm,
            EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2) AS is_member
     FROM channels c
     LEFT JOIN channel_members me ON me.channel_id = c.id AND me.user_id = $2
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND c.name ILIKE $3
       AND (c.is_private = false OR me.user_id IS NOT NULL)
     ORDER BY c.name ASC
     LIMIT 10`,
    [organizationId, userId, like]
  );

  // DMs: match on the other participant's name.
  const dms = await pool.query(
    `SELECT c.id AS channel_id, other.id AS user_id, p.full_name, other.status
     FROM channels c
     JOIN channel_members me ON me.channel_id = c.id AND me.user_id = $2
     JOIN channel_members them ON them.channel_id = c.id AND them.user_id <> $2
     JOIN users other ON other.id = them.user_id
     LEFT JOIN employee_profiles p ON p.user_id = other.id
     WHERE c.organization_id = $1 AND c.is_dm = true AND p.full_name ILIKE $3
     ORDER BY p.full_name ASC
     LIMIT 10`,
    [organizationId, userId, like]
  );

  return { channels: channels.rows, dms: dms.rows };
}
