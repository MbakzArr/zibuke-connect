import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';

// Parse @mentions out of a message and turn them into mention rows +
// notifications. Mentions are matched against the display names of people
// who are MEMBERS of the same channel, so you can only mention someone who
// can actually see the message. A special @channel mentions everyone in it.

// Pull the raw @tokens out of the text. Matches @word or @"two words".
function extractMentionTokens(content: string): string[] {
  const tokens = new Set<string>();
  // @channel keyword
  const keywordMatch = content.match(/@channel\b/gi);
  if (keywordMatch) tokens.add('channel');

  // @Firstname or @Firstname.Lastname style single-token mentions
  const nameMatches = content.match(/@([A-Za-z][A-Za-z.'-]*)/g);
  if (nameMatches) {
    for (const m of nameMatches) {
      const clean = m.slice(1).toLowerCase();
      if (clean !== 'channel') tokens.add(clean);
    }
  }
  return Array.from(tokens);
}

// Match name tokens (already extracted, "channel" keyword handled
// separately by each caller since what it MEANS differs - everyone in a
// channel vs. everyone an announcement reaches) against a list of
// candidate people, the same way in both places this is used.
function matchNameTokens(tokens: string[], candidates: { id: string; full_name: string | null }[], excludeUserId: string): Set<string> {
  const matched = new Set<string>();
  for (const token of tokens) {
    if (token === 'channel') continue;
    for (const c of candidates) {
      if (c.id === excludeUserId || !c.full_name) continue;
      const full = c.full_name.toLowerCase();
      const first = full.split(' ')[0];
      // token might be "thabo" or "thabo.ndlovu"
      const normalisedToken = token.replace(/\./g, ' ');
      if (first === token || full === normalisedToken) {
        matched.add(c.id);
      }
    }
  }
  return matched;
}

// Given a message that was just created, find who it mentions and record +
// notify them. Skips the author (you don't get notified for @-ing yourself).
export async function processMentions(
  messageId: string,
  channelId: string,
  authorId: string,
  content: string
) {
  const tokens = extractMentionTokens(content);
  if (tokens.length === 0) return;

  // Everyone in the channel, with their names, so we can match tokens to ids.
  const membersResult = await pool.query(
    `SELECT u.id, p.full_name
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     WHERE cm.channel_id = $1`,
    [channelId]
  );
  const members = membersResult.rows;

  const mentionedUserIds = matchNameTokens(tokens, members, authorId);

  // @channel: everyone in the channel except the author.
  if (tokens.includes('channel')) {
    for (const m of members) {
      if (m.id !== authorId) mentionedUserIds.add(m.id);
    }
  }

  if (mentionedUserIds.size === 0) return;

  // Record the mention rows and fire a notification for each.
  for (const userId of mentionedUserIds) {
    await pool.query(
      `INSERT INTO mentions (message_id, mentioned_user_id) VALUES ($1, $2)`,
      [messageId, userId]
    );
    await createNotification({ userId, type: 'mention', sourceId: messageId });
  }
}

// Same idea, for an announcement instead of a message - this was
// requested but never actually built, so @mentions in an announcement
// have never notified anyone before now. "Everyone who can see it" is
// the audience: org-wide for an org-wide announcement, just that
// department for a department-scoped one - matches the same visibility
// rule announcements.service.ts's listAnnouncements already enforces for
// reading them, so a mention can't reach someone who couldn't see the
// announcement in the first place. No mentions table involved (that
// table is message-specific) - this only ever creates notifications.
export async function processAnnouncementMentions(
  announcementId: string,
  organizationId: string,
  departmentId: string | null,
  authorId: string,
  content: string
) {
  const tokens = extractMentionTokens(content);
  if (tokens.length === 0) return;

  const candidatesResult = await pool.query(
    departmentId
      ? `SELECT u.id, p.full_name FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
         WHERE u.organization_id = $1 AND u.department_id = $2 AND u.deleted_at IS NULL`
      : `SELECT u.id, p.full_name FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
         WHERE u.organization_id = $1 AND u.deleted_at IS NULL`,
    departmentId ? [organizationId, departmentId] : [organizationId]
  );
  const candidates = candidatesResult.rows;

  const mentionedUserIds = matchNameTokens(tokens, candidates, authorId);

  // @channel doesn't mean anything for an announcement - there's no
  // channel to address, only the audience it was already scoped to, so
  // that keyword is simply not recognised here.

  for (const userId of mentionedUserIds) {
    await createNotification({ userId, type: 'announcement_mention', sourceId: announcementId });
  }
}
