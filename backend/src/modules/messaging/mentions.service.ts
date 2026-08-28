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

  const mentionedUserIds = new Set<string>();

  // @channel: everyone in the channel except the author.
  if (tokens.includes('channel')) {
    for (const m of members) {
      if (m.id !== authorId) mentionedUserIds.add(m.id);
    }
  }

  // Name tokens: match against the first name or full name (lowercased).
  for (const token of tokens) {
    if (token === 'channel') continue;
    for (const m of members) {
      if (m.id === authorId || !m.full_name) continue;
      const full = m.full_name.toLowerCase();
      const first = full.split(' ')[0];
      // token might be "thabo" or "thabo.ndlovu"
      const normalisedToken = token.replace(/\./g, ' ');
      if (first === token || full === normalisedToken) {
        mentionedUserIds.add(m.id);
      }
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
