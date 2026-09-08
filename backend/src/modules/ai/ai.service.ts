import { pool } from '../../db/pool';

// A small, fast instruction-tuned model - plenty for summarizing a chat
// channel, and cheap enough on the free "neurons" budget to actually use
// day to day rather than save for special occasions. See
// developers.cloudflare.com/workers-ai/models/ for the full catalog if
// this ever needs to move to something larger.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Bounds how much a single summary can cost, in two ways: fewer messages
// in means a shorter prompt (cheaper, faster), and max_tokens bounds how
// long the model's reply can run.
const MAX_MESSAGES = 80;
const MAX_SUMMARY_TOKENS = 400;

// Same idea for the writing assistant - a rewrite should never come back
// wildly longer than what was typed in.
const MAX_REWRITE_INPUT_CHARS = 2000;
const MAX_REWRITE_TOKENS = 400;

interface ChannelMessageForSummary {
  sender_name: string | null;
  content: string;
}

async function callWorkersAI(messages: { role: string; content: string }[], maxTokens: number): Promise<string> {
  const accountId = process.env.R2_ACCOUNT_ID; // same Cloudflare account, no separate id needed
  const token = process.env.CF_AI_API_TOKEN;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, max_tokens: maxTokens }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Workers AI error:', res.status, text);
    throw new Error('AI_REQUEST_FAILED');
  }

  const data: any = await res.json();
  if (!data.success || !data.result?.response) {
    console.error('Workers AI unsuccessful response:', JSON.stringify(data));
    throw new Error('AI_REQUEST_FAILED');
  }
  return data.result.response.trim();
}

// "Catch me up" - summarizes everything in a channel since a given point
// in time. That point has to be captured by the CALLER at the moment the
// channel was opened, before markChannelRead overwrites channel_reads for
// this visit - re-deriving "since" from channel_reads here would almost
// always find nothing, because opening the channel (which is what makes
// the "catch me up" button visible in the first place) is the same action
// that just marked everything up to now as read. If the caller has
// nothing captured yet (their very first visit to this channel), this
// falls back to just the most recent messages instead of the full
// history. Membership is checked by the controller before this is ever
// called - the AI never sees anything the person couldn't already read
// themselves.
export async function summarizeChannel(channelId: string, since: string | null) {
  const result = await pool.query(
    `SELECT p.full_name AS sender_name, m.content
     FROM messages m
     LEFT JOIN employee_profiles p ON p.user_id = m.user_id
     WHERE m.channel_id = $1
       AND m.deleted_at IS NULL
       ${since ? 'AND m.created_at > $2' : ''}
     ORDER BY m.created_at DESC
     LIMIT ${MAX_MESSAGES}`,
    since ? [channelId, since] : [channelId]
  );
  const rows: ChannelMessageForSummary[] = result.rows;

  if (rows.length === 0) {
    return { summary: null as string | null, messageCount: 0 };
  }

  // Reverse back to chronological order - fetched newest-first (for the
  // LIMIT to keep the most RECENT messages when there are more than
  // MAX_MESSAGES), but the model should read them in the order they
  // actually happened.
  const chronological = rows.reverse();
  const transcript = chronological
    .map((m) => `${m.sender_name || 'Someone'}: ${m.content}`)
    .join('\n');

  const summary = await callWorkersAI([
    {
      role: 'system',
      content:
        'You summarize workplace chat conversations. Be concise - use short bullet points covering key topics, decisions, and anything anyone was asked to do. No preamble, no sign-off, just the summary itself.',
    },
    { role: 'user', content: transcript },
  ], MAX_SUMMARY_TOKENS);

  return { summary, messageCount: chronological.length };
}

const REWRITE_INSTRUCTIONS: Record<string, string> = {
  clearer:
    'Rewrite the following workplace chat message to be clearer and easier to understand. Keep the same meaning and roughly the same length. Reply with only the rewritten message, nothing else - no preamble, no quotes around it.',
  shorter:
    'Rewrite the following workplace chat message to be more concise, keeping the key meaning. Reply with only the rewritten message, nothing else - no preamble, no quotes around it.',
  grammar:
    'Fix the grammar and spelling in the following workplace chat message. Keep the tone, meaning, and length as close to the original as possible - make only the corrections needed. Reply with only the corrected message, nothing else - no preamble, no quotes around it.',
  professional:
    'Rewrite the following workplace chat message in a more professional tone, suitable for a workplace conversation. Keep the same meaning. Reply with only the rewritten message, nothing else - no preamble, no quotes around it.',
};

export type RewriteStyle = keyof typeof REWRITE_INSTRUCTIONS;

// The writing assistant - rewrites a draft the user is about to send. Never
// touches anything already sent or anyone else's messages; the text comes
// straight from whatever's in the person's own composer, and the result
// only ever replaces that same draft box, never sends anything itself.
export async function rewriteText(text: string, style: string) {
  const instruction = REWRITE_INSTRUCTIONS[style];
  if (!instruction) {
    throw new Error('INVALID_STYLE');
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('EMPTY_TEXT');
  }
  if (trimmed.length > MAX_REWRITE_INPUT_CHARS) {
    throw new Error('TOO_LONG');
  }

  const rewritten = await callWorkersAI(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: trimmed },
    ],
    MAX_REWRITE_TOKENS
  );
  return rewritten;
}
