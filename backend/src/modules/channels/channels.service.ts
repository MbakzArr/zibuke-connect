import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';
import { runInBackground } from '../../util/background';
import { emitToUser } from '../messaging/realtime';

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
  visibleToCandidates?: boolean;
}

// List the channels a user can see: every public channel in their org,
// plus any private channel they're actually a member of. DMs are excluded
// here, they're fetched separately so the channel list stays clean.
// What a viewer is allowed to see, in terms of channel visibility -
// shared by listChannelsForUser and listBrowsableChannels below, and by
// the AI/search paths later if those ever need the same rule. Mirrors
// exactly how announcements.service.ts scopes announcements, so someone
// reading either query already understands the other.
interface ChannelViewerScope {
  isAdmin: boolean;
  isCandidate: boolean;
  departmentId: string | null;
}

async function getChannelViewerScope(userId: string): Promise<ChannelViewerScope> {
  const result = await pool.query('SELECT role, department_id, user_type FROM users WHERE id = $1', [userId]);
  const row = result.rows[0];
  return {
    isAdmin: row?.role === 'admin',
    isCandidate: row?.user_type === 'candidate',
    departmentId: row?.department_id ?? null,
  };
}

// Admins see everything, same as everywhere else in the app. A candidate
// sees ONLY channels explicitly opted in for candidates - this
// completely overrides the department rule below, since a candidate
// isn't really "in" a department at all. Everyone else sees org-wide
// channels (no department set) plus their own department's channels -
// unchanged from before this feature existed, since department_id was
// only ever a label until now; every existing channel has no department
// set, so this is a no-op for them.
//
// Returns a bare boolean SQL expression (no leading AND/OR) meant to be
// combined with "already a member" via OR - being an active member of a
// channel always keeps it visible to you regardless of this rule, the
// same way private channels already work; you shouldn't lose sight of a
// channel you're in just because your department later changed.
function channelVisibilityExpr(scope: ChannelViewerScope, deptParamIndex: number): { sql: string; param?: string } {
  if (scope.isAdmin) return { sql: 'true' };
  if (scope.isCandidate) return { sql: 'c.visible_to_candidates = true' };
  if (scope.departmentId) {
    return { sql: `(c.department_id IS NULL OR c.department_id = $${deptParamIndex})`, param: scope.departmentId };
  }
  return { sql: 'c.department_id IS NULL' };
}

// The sidebar list - ONLY channels you've actually joined, public or
// private, department-scoped or not. Public channels you haven't joined
// yet are discovered through Browse Channels instead, not shown here with
// a join prompt - this used to also list every visible-but-unjoined
// public channel, which made the sidebar the place people accidentally
// discovered channels in, cluttering it with things they hadn't actually
// joined. Department/candidate visibility no longer needs computing here
// at all - membership is now the only gate, and if you're a member you
// see it regardless of whether your department later changed.
export async function listChannelsForUser(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.department_id, d.name AS department_name, c.is_private, c.created_by, c.created_at,
            (SELECT COUNT(*) FROM channel_members cm2 WHERE cm2.channel_id = c.id) AS member_count,
            EXISTS (
              SELECT 1 FROM messages m
              WHERE m.channel_id = c.id
                AND m.deleted_at IS NULL
                AND m.user_id <> $2
                AND m.created_at > COALESCE(
                  (SELECT last_read_at FROM channel_reads cr WHERE cr.channel_id = c.id AND cr.user_id = $2),
                  '-infinity'
                )
            ) AS has_unread
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
     LEFT JOIN departments d ON d.id = c.department_id
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND c.deleted_at IS NULL
       AND (
         cm.cleared_at IS NULL
         OR EXISTS (
           SELECT 1 FROM messages m2
           WHERE m2.channel_id = c.id AND m2.deleted_at IS NULL AND m2.created_at > cm.cleared_at
         )
       )
     ORDER BY c.name ASC`,
    [organizationId, userId]
  );
  return result.rows;
}

// Mark a channel as read by this user right now. Called when they open it.
// Returns the timestamp actually stored, so the caller can push it out live.
// Marks a channel as read (updates last_read_at to now), but also hands
// back what last_read_at was BEFORE this call - the summarize-channel
// feature needs that previous value, captured at the moment the channel
// was opened, not a fresh read of channel_reads after the fact (which
// would just show this same visit's timestamp and always come back
// empty - see ai.service.ts's comment on why "since" is passed in
// explicitly instead of being re-derived here).
export async function markChannelRead(userId: string, channelId: string) {
  const previous = await pool.query(
    'SELECT last_read_at FROM channel_reads WHERE user_id = $1 AND channel_id = $2',
    [userId, channelId]
  );
  const previousReadAt = previous.rows[0]?.last_read_at ?? null;

  const result = await pool.query(
    `INSERT INTO channel_reads (user_id, channel_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = now()
     RETURNING last_read_at`,
    [userId, channelId]
  );
  return { lastReadAt: result.rows[0].last_read_at, previousReadAt };
}

// For a DM, when did the OTHER participant last read it - powers the
// "Seen" tick on your own messages. Null if they've never opened it (or
// this isn't a DM / has no other member, e.g. a self-DM).
export async function getDmOtherReadAt(channelId: string, userId: string) {
  const result = await pool.query(
    `SELECT cr.last_read_at
     FROM channels c
     JOIN channel_members them ON them.channel_id = c.id AND them.user_id <> $2
     LEFT JOIN channel_reads cr ON cr.channel_id = c.id AND cr.user_id = them.user_id
     WHERE c.id = $1 AND c.is_dm = true
     LIMIT 1`,
    [channelId, userId]
  );
  return result.rows[0]?.last_read_at || null;
}

export async function getChannel(organizationId: string, channelId: string) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.department_id, d.name AS department_name, c.is_private, c.is_dm, c.created_by, c.created_at
     FROM channels c
     LEFT JOIN departments d ON d.id = c.department_id
     WHERE c.organization_id = $1 AND c.id = $2`,
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

// "Clear" - personal only, keeps membership. Hides the channel from just
// this person's sidebar and hides history before this point in THEIR
// view only; a new message after this point makes it reappear naturally,
// and they can keep posting into it the whole time. Genuinely different
// from Leave (which removes membership) - this exists specifically so
// people can keep a tidy sidebar without losing access to a channel they
// might come back to.
export async function clearChannelForUser(channelId: string, userId: string): Promise<void> {
  await pool.query(
    'UPDATE channel_members SET cleared_at = now() WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
}

// Real deletion - affects everyone, not just the caller. Restricted to
// the channel's creator or an admin (same rule already used for
// approving join requests, kept consistent rather than inventing a new
// permission model). Soft delete: messages are left in the database for
// audit, same as individual message deletion already works in this app -
// the channel just becomes invisible and unopenable for everyone.
export async function deleteChannelForEveryone(channelId: string, requesterId: string, requesterIsAdmin: boolean): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  const channel = await pool.query('SELECT created_by FROM channels WHERE id = $1 AND deleted_at IS NULL', [channelId]);
  if (channel.rows.length === 0) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (!requesterIsAdmin && channel.rows[0].created_by !== requesterId) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  await pool.query('UPDATE channels SET deleted_at = now() WHERE id = $1', [channelId]);
  return { ok: true };
}

export async function createChannel(input: CreateChannelInput) {
  const { organizationId, name, createdBy, departmentId, isPrivate, visibleToCandidates } = input;

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
      `INSERT INTO channels (organization_id, department_id, name, is_private, is_dm, created_by, visible_to_candidates)
       VALUES ($1, $2, $3, $4, false, $5, $6)
       RETURNING id, name, department_id, is_private, is_dm, created_by, created_at, visible_to_candidates`,
      [organizationId, departmentId || null, name, isPrivate || false, createdBy, Boolean(visibleToCandidates)]
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

// The actual membership write - shared by request-approval, direct-add,
// and any other path that adds someone to a channel. Not called directly
// by the join route anymore; see requestToJoin below for that.
async function addMember(channelId: string, userId: string) {
  await pool.query(
    `INSERT INTO channel_members (channel_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (channel_id, user_id) DO NOTHING`,
    [channelId, userId]
  );
}

// Whether someone still has "creator" authority over a channel - true
// only if they made it AND are still actually a member of it. A creator
// who's since left shouldn't retain approval rights or the ability to
// add people to a space they're no longer part of; admins are the
// permanent fallback either way, so nothing is ever left unmanaged.
async function isActiveCreator(channelId: string, createdBy: string, userId: string): Promise<boolean> {
  if (createdBy !== userId) return false;
  return isMember(channelId, userId);
}

export async function canManageChannel(channelId: string, createdBy: string, userId: string, userIsAdmin: boolean): Promise<boolean> {
  if (userIsAdmin) return true;
  return isActiveCreator(channelId, createdBy, userId);
}

// Add someone directly, bypassing the self-request flow entirely -
// needed for private channels (which have no self-request path at all)
// and for candidates (who can only ever request to join a channel
// that's already marked visible to them - there was previously no way
// to get them into ANY channel without that already being true first,
// and no way to add them at all without them requesting themselves).
// Same permission rule as everything else channel-management related:
// the creator (while still a member) or an admin.
export async function addMemberDirectly(
  organizationId: string,
  channelId: string,
  userId: string,
  requesterId: string,
  requesterIsAdmin: boolean
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_MEMBER' | 'USER_NOT_FOUND' }> {
  const channel = await pool.query(
    'SELECT created_by FROM channels WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
    [channelId, organizationId]
  );
  if (channel.rows.length === 0) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  const allowed = await canManageChannel(channelId, channel.rows[0].created_by, requesterId, requesterIsAdmin);
  if (!allowed) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  const target = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
    [userId, organizationId]
  );
  if (target.rows.length === 0) {
    return { ok: false, reason: 'USER_NOT_FOUND' };
  }
  if (await isMember(channelId, userId)) {
    return { ok: false, reason: 'ALREADY_MEMBER' };
  }
  await addMember(channelId, userId);

  // The person being added deserves to know, same as anyone whose join
  // request gets approved - this was the actual gap being reported: the
  // channel would just silently appear (or not, since the sidebar isn't
  // live-pushed on membership changes either) with nothing telling them
  // why or that it happened at all.
  runInBackground(
    (async () => {
      await createNotification({ userId, type: 'channel_added', sourceId: channelId });
      emitToUser(userId, 'channel:added', { channelId });
    })()
  );

  return { ok: true };
}

// Who should be asked to approve a join request: the channel's creator
// (only while they're still actually a member of it), plus every admin
// in the org - admins are a PERMANENT backdoor, not just a fallback for
// when the creator's account no longer exists, and a creator who's left
// the channel shouldn't linger as an approver for a space they're no
// longer part of.
// Who gets notified and can approve a join request: the channel's
// creator, PLUS every admin - admins act as a permanent backdoor for
// every channel, not just a fallback for when a creator's account no
// longer exists, so there's always someone who can approve a request
// even if the creator is on leave, unresponsive, or has moved on.
async function getJoinApprovers(organizationId: string, channelId: string, createdBy: string): Promise<string[]> {
  const approvers = new Set<string>();

  if (await isActiveCreator(channelId, createdBy, createdBy)) {
    approvers.add(createdBy);
  }

  const admins = await pool.query(
    `SELECT id FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL`,
    [organizationId]
  );
  for (const row of admins.rows) approvers.add(row.id);

  return Array.from(approvers);
}

// The new front door for joining a public channel - creates a pending
// request instead of joining immediately, and notifies whoever needs to
// approve it. Idempotent: already a member -> no-op; already have a
// pending request -> returns that instead of creating a duplicate (the
// partial unique index would reject a second one anyway, this just
// avoids surfacing that as an error to a well-behaved double-click).
export async function requestToJoin(organizationId: string, channelId: string, userId: string) {
  const channel = await getChannel(organizationId, channelId);
  if (!channel) {
    throw new Error('NOT_FOUND');
  }
  if (channel.is_private || channel.is_dm) {
    throw new Error('CANNOT_SELF_JOIN');
  }

  const already = await isMember(channelId, userId);
  if (already) {
    return { status: 'already_member' as const };
  }

  const existing = await pool.query(
    `SELECT id FROM channel_join_requests WHERE channel_id = $1 AND user_id = $2 AND status = 'pending'`,
    [channelId, userId]
  );
  if (existing.rows.length > 0) {
    return { status: 'already_requested' as const, requestId: existing.rows[0].id };
  }

  const inserted = await pool.query(
    `INSERT INTO channel_join_requests (channel_id, user_id) VALUES ($1, $2) RETURNING id`,
    [channelId, userId]
  );
  const requestId = inserted.rows[0].id;

  const approvers = await getJoinApprovers(organizationId, channelId, channel.created_by);
  for (const approverId of approvers) {
    runInBackground(createNotification({ userId: approverId, type: 'channel_join_request', sourceId: requestId }));
  }

  return { status: 'requested' as const, requestId };
}

// Every pending request for a channel, with the requester's name - what
// the approval modal renders. Only meaningful for whoever's allowed to
// see it; the controller checks that before calling this.
export async function listPendingRequests(channelId: string) {
  const result = await pool.query(
    `SELECT r.id, r.user_id, r.requested_at, p.full_name, u.email
     FROM channel_join_requests r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN employee_profiles p ON p.user_id = r.user_id
     WHERE r.channel_id = $1 AND r.status = 'pending'
     ORDER BY r.requested_at ASC`,
    [channelId]
  );
  return result.rows;
}

// Approve or reject a pending request. Only the channel's creator, or an
// admin if the creator's account is gone, is allowed to call this - the
// controller checks that (same getJoinApprovers list) before calling in.
export async function resolveJoinRequest(requestId: string, approverId: string, decision: 'approved' | 'rejected') {
  const request = await pool.query(
    `SELECT id, channel_id, user_id, status FROM channel_join_requests WHERE id = $1`,
    [requestId]
  );
  if (request.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  const row = request.rows[0];
  if (row.status !== 'pending') {
    throw new Error('ALREADY_RESOLVED');
  }

  await pool.query(
    `UPDATE channel_join_requests SET status = $1, resolved_at = now(), resolved_by = $2 WHERE id = $3`,
    [decision, approverId, requestId]
  );

  if (decision === 'approved') {
    await addMember(row.channel_id, row.user_id);
  }

  // Either way, the person who asked deserves to know. sourceId points at
  // the channel, not the (now-resolved) request row - once resolved, the
  // request itself is no longer the useful thing to show; the channel is.
  runInBackground(
    (async () => {
      await createNotification({
        userId: row.user_id,
        type: decision === 'approved' ? 'channel_join_approved' : 'channel_join_rejected',
        sourceId: row.channel_id,
      });
      emitToUser(row.user_id, 'channel:join_resolved', { channelId: row.channel_id, approved: decision === 'approved' });
    })()
  );

  return { channelId: row.channel_id, decision };
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
  // For each DM the user is in, resolve "the other person". For a normal DM
  // that's the other member; for a self-DM (only you), it resolves to you, so
  // "notes to self" shows up in the list too. COALESCE picks the other member
  // if there is one, otherwise falls back to the user themselves.
  //
  // Ordered by the most recent message in each DM (newest first) - it used
  // to be plain alphabetical by name, which meant a DM never moved when a
  // new message came in. DMs with no messages yet (a fresh "New DM" with
  // nothing sent) fall to the end, alphabetically among themselves.
  const result = await pool.query(
    `SELECT c.id AS channel_id,
            COALESCE(other.id, me_user.id) AS user_id,
            COALESCE(op.full_name, mp.full_name) AS full_name,
            COALESCE(other.status, me_user.status) AS status,
            COALESCE(op.job_title, mp.job_title) AS job_title,
            (other.id IS NULL) AS is_self,
            lm.last_message_at
     FROM channels c
     JOIN channel_members me ON me.channel_id = c.id AND me.user_id = $2
     JOIN users me_user ON me_user.id = $2
     LEFT JOIN employee_profiles mp ON mp.user_id = me_user.id
     LEFT JOIN channel_members them ON them.channel_id = c.id AND them.user_id <> $2
     LEFT JOIN users other ON other.id = them.user_id
     LEFT JOIN employee_profiles op ON op.user_id = other.id
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS last_message_at FROM messages WHERE channel_id = c.id
     ) lm ON true
     WHERE c.organization_id = $1 AND c.is_dm = true
     ORDER BY lm.last_message_at DESC NULLS LAST, full_name ASC`,
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
  const scope = await getChannelViewerScope(userId);
  const visibility = channelVisibilityExpr(scope, 3);
  const params = visibility.param ? [organizationId, userId, visibility.param] : [organizationId, userId];

  const result = await pool.query(
    `SELECT c.id, c.name, c.department_id, d.name AS department_name, c.is_private, c.created_at, c.created_by,
            (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) AS member_count,
            EXISTS (
              SELECT 1 FROM channel_members me
              WHERE me.channel_id = c.id AND me.user_id = $2
            ) AS is_member,
            EXISTS (
              SELECT 1 FROM channel_join_requests jr
              WHERE jr.channel_id = c.id AND jr.user_id = $2 AND jr.status = 'pending'
            ) AS has_pending_request,
            (SELECT COUNT(*) FROM channel_join_requests jr2 WHERE jr2.channel_id = c.id AND jr2.status = 'pending') AS pending_request_count
     FROM channels c
     LEFT JOIN departments d ON d.id = c.department_id
     LEFT JOIN channel_members cm2 ON cm2.channel_id = c.id AND cm2.user_id = $2
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND c.is_private = false
       AND c.deleted_at IS NULL
       AND (cm2.user_id IS NOT NULL OR ${visibility.sql})
     ORDER BY c.name ASC`,
    params
  );

  // can_manage_requests here mirrors canManageChannel exactly (admin, or
  // creator while still a member) - this is what actually lets an admin
  // manage join requests for a channel they're not in yet: Browse
  // Channels is the one place they can reach that ability without
  // needing to open the channel itself, since they may not even be able
  // to open it (a private channel, or simply not having joined a public
  // one) - the previous UI had no path to this at all for a non-member
  // admin, even though the permission itself was already correctly
  // backend-enforced.
  return result.rows.map((row) => ({
    ...row,
    can_manage_requests: scope.isAdmin || (row.created_by === userId && row.is_member),
  }));
}

// Search the channels and DMs a user can navigate to, by name. Returns
// public channels (joinable), channels they're in, and DMs matched by the
// other person's name. Powers "jump to a place" in global search.
export async function searchChannelsAndDms(organizationId: string, userId: string, query: string) {
  const like = `%${query}%`;

  // Same visibility rule as listBrowsableChannels - this search was a
  // completely separate query that predated department/candidate
  // scoping and was never updated to match, so it was showing
  // department-restricted channels (and letting candidates find regular
  // channels) regardless of who was searching. Being a member always
  // overrides the visibility rule, same reasoning as everywhere else:
  // you shouldn't lose access to something you're already in.
  const scope = await getChannelViewerScope(userId);
  const visibility = channelVisibilityExpr(scope, 4);
  const channelParams = visibility.param ? [organizationId, userId, like, visibility.param] : [organizationId, userId, like];

  // Channels: public ones within visibility scope, plus private ones the
  // user is a member of, name match.
  const channels = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.is_private, c.is_dm,
            EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2) AS is_member
     FROM channels c
     LEFT JOIN channel_members me ON me.channel_id = c.id AND me.user_id = $2
     WHERE c.organization_id = $1
       AND c.is_dm = false
       AND c.deleted_at IS NULL
       AND c.name ILIKE $3
       AND (c.is_private = false OR me.user_id IS NOT NULL)
       AND (me.user_id IS NOT NULL OR ${visibility.sql})
     ORDER BY c.name ASC
     LIMIT 10`,
    channelParams
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

// Ids of every OTHER member of a channel (excludes the given user). Used to
// ping people with "this channel has new activity" without needing every
// client to join every channel's socket room.
export async function getOtherChannelMemberIds(channelId: string, excludeUserId: string): Promise<string[]> {
  const result = await pool.query(
    'SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2',
    [channelId, excludeUserId]
  );
  return result.rows.map((r) => r.user_id);
}
