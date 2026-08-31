import { pool } from '../../db/pool';

// One reactions system for everything. A reaction points at a target by
// (target_type, target_id): an announcement's uuid, or a birthday person's
// user id. Toggling is idempotent, react again with the same emoji to remove.

// The fixed, minimal set the UI offers. Kept small and clean on purpose
// (no free emoji picker). Validated server-side so only these can be stored.
const ALLOWED_EMOJI = ['🎉', '👍', '❤️', '🥳', '👏'];

type TargetType = 'announcement' | 'birthday' | 'message';

// Toggle a reaction: add it if absent, remove it if the user already reacted
// with that emoji on that target. Returns 'added' or 'removed'.
export async function toggleReaction(
  organizationId: string,
  userId: string,
  targetType: TargetType,
  targetId: string,
  emoji: string
): Promise<'added' | 'removed'> {
  if (!ALLOWED_EMOJI.includes(emoji)) {
    throw new Error('INVALID_EMOJI');
  }

  // Look at what this user has already reacted on this target.
  const existing = await pool.query(
    `SELECT id, emoji FROM reactions
     WHERE target_type = $1 AND target_id = $2 AND user_id = $3`,
    [targetType, targetId, userId]
  );

  // If they already reacted with THIS emoji, toggle it off.
  const sameEmoji = existing.rows.find((r) => r.emoji === emoji);
  if (sameEmoji) {
    await pool.query('DELETE FROM reactions WHERE id = $1', [sameEmoji.id]);
    return 'removed';
  }

  // One reaction per person per item: clear any other reaction this user has
  // on this target before adding the new one. Enforced here, server-side, so
  // the rule holds even if a client tries to send several.
  if (existing.rows.length > 0) {
    await pool.query(
      `DELETE FROM reactions WHERE target_type = $1 AND target_id = $2 AND user_id = $3`,
      [targetType, targetId, userId]
    );
  }

  await pool.query(
    `INSERT INTO reactions (organization_id, target_type, target_id, emoji, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, targetType, targetId, emoji, userId]
  );
  return 'added';
}

// Get reaction counts for a set of targets of one type, plus which emoji the
// current user has reacted with (so the UI can highlight their choices).
// Returns a map: targetId -> { emoji -> { count, reacted } }.
export async function getReactions(
  organizationId: string,
  userId: string,
  targetType: TargetType,
  targetIds: string[]
) {
  if (targetIds.length === 0) return {};

  const result = await pool.query(
    `SELECT target_id, emoji,
            COUNT(*)::int AS count,
            bool_or(user_id = $3) AS reacted
     FROM reactions
     WHERE organization_id = $1
       AND target_type = $2
       AND target_id = ANY($4)
     GROUP BY target_id, emoji`,
    [organizationId, targetType, userId, targetIds]
  );

  const map: Record<string, Record<string, { count: number; reacted: boolean }>> = {};
  for (const row of result.rows) {
    if (!map[row.target_id]) map[row.target_id] = {};
    map[row.target_id][row.emoji] = { count: row.count, reacted: row.reacted };
  }
  return map;
}

export { ALLOWED_EMOJI };
