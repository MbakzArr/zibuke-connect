import { pool } from '../../db/pool';
import { listAnnouncements } from '../announcements/announcements.service';
import { listMyTasks } from '../tasks/tasks.service';

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
  // Normally a plain string, but when the prompt explicitly asks for JSON
  // output (extractTask below), Workers AI has been observed handing back
  // an already-parsed object here instead of a raw string - .trim() would
  // crash on that. Stringify it in that case, and let the caller's own
  // parsing (extractTask already expects to pull JSON out of messy text)
  // handle either shape the same way.
  const response = data.result.response;
  return typeof response === 'string' ? response.trim() : JSON.stringify(response);
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

const MAX_EXTRACT_INPUT_CHARS = 2000;
const MAX_EXTRACT_TOKENS = 200;

export interface ExtractedTask {
  hasTask: boolean;
  title: string | null;
  assigneeName: string | null;
  dueDate: string | null; // YYYY-MM-DD, or null if no date was mentioned
}

// Looks at one message and asks whether it contains an actionable task -
// "Thabo, please finish the API docs by Friday" - and if so, pulls out a
// short title, who it sounds like it's for, and a due date. This is only
// ever a SUGGESTION: nothing gets created here. The caller shows it to the
// person as a "Create task?" confirmation they can edit or reject -
// assigneeName especially is just the AI's best guess at a name from the
// text, not a real user id, so the frontend has to resolve it against
// actual channel members before anything can actually be created.
export async function extractTask(text: string): Promise<ExtractedTask> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('EMPTY_TEXT');
  }
  if (trimmed.length > MAX_EXTRACT_INPUT_CHARS) {
    throw new Error('TOO_LONG');
  }

  const today = new Date().toISOString().slice(0, 10);
  const raw = await callWorkersAI(
    [
      {
        role: 'system',
        content:
          `Today's date is ${today}. Decide whether the following workplace chat message contains a clear, actionable task assigned to someone (something specific someone was asked to do). ` +
          `Reply with ONLY a JSON object, no other text, in exactly this shape: ` +
          `{"hasTask": boolean, "title": string or null, "assigneeName": string or null, "dueDate": "YYYY-MM-DD" or null}. ` +
          `"title" should be a short task description (a few words), not the whole message. "assigneeName" is the first name of whoever the task is for, if the message names them or clearly addresses them directly - otherwise null. ` +
          `"dueDate" should be an actual calendar date worked out from today's date if the message mentions one (e.g. "by Friday", "tomorrow") - otherwise null. ` +
          `If the message is just chat with no real task in it, reply {"hasTask": false, "title": null, "assigneeName": null, "dueDate": null}.`,
      },
      { role: 'user', content: trimmed },
    ],
    MAX_EXTRACT_TOKENS
  );

  try {
    // Models occasionally wrap JSON in a code fence or add a stray word
    // before/after it despite being told not to - pull out just the {...}
    // rather than trusting the whole response to be valid JSON on its own.
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      hasTask: Boolean(parsed.hasTask),
      title: typeof parsed.title === 'string' ? parsed.title : null,
      assigneeName: typeof parsed.assigneeName === 'string' ? parsed.assigneeName : null,
      dueDate: typeof parsed.dueDate === 'string' ? parsed.dueDate : null,
    };
  } catch (err) {
    console.error('Extract task: could not parse model output:', raw);
    // Not a hard failure - just means "no task found", same as the model
    // genuinely saying so. A malformed response isn't the person's problem.
    return { hasTask: false, title: null, assigneeName: null, dueDate: null };
  }
}

const MAX_ASK_INPUT_CHARS = 500;
const MAX_ASK_TOKENS = 350;
const MAX_CONTEXT_ANNOUNCEMENTS = 15;
const MAX_CONTEXT_TASKS = 15;
const MAX_CONTEXT_EVENTS = 10;
const MAX_ANNOUNCEMENT_PREVIEW_CHARS = 300;

// Same idea as announcements.controller.ts's own getViewerScope, kept as
// its own small copy here rather than importing a controller function
// into a service - undefined means "admin, see everything",
// null means "not in a department, org-wide only".
async function getViewerDepartment(userId: string, isAdmin: boolean): Promise<string | null | undefined> {
  if (isAdmin) return undefined;
  const result = await pool.query('SELECT department_id FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.department_id ?? null;
}

// Knowledge Q&A - "what's the latest HR announcement", "what tasks are
// assigned to me", "when's the next team meeting". Deliberately answers
// from announcements, tasks, and events only, not live channel messages -
// searching message history safely (respecting exactly who's a member of
// which channel) is a meaningfully bigger problem on its own, and
// "Catch me up" already covers "what happened in this channel" separately.
//
// The security principle that matters here: every piece of context comes
// from a call that ALREADY enforces who's allowed to see it -
// listAnnouncements is the exact same department-scoped query the
// announcements feed itself uses, listMyTasks only ever returns this
// user's own tasks. The AI is never handed anything through a new,
// separate permission path - it only ever sees a bounded slice of what
// the asker could already see themselves.
export async function askQuestion(organizationId: string, userId: string, isAdmin: boolean, isCandidate: boolean, question: string): Promise<string> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error('EMPTY_TEXT');
  }
  if (trimmed.length > MAX_ASK_INPUT_CHARS) {
    throw new Error('TOO_LONG');
  }

  const viewerDept = await getViewerDepartment(userId, isAdmin);
  const [announcements, myTasks, eventsResult] = await Promise.all([
    listAnnouncements(organizationId, viewerDept, isCandidate),
    listMyTasks(organizationId, userId),
    pool.query(
      `SELECT title, starts_at FROM events WHERE organization_id = $1 AND starts_at >= now() ORDER BY starts_at ASC LIMIT ${MAX_CONTEXT_EVENTS}`,
      [organizationId]
    ),
  ]);

  const announcementLines = announcements.slice(0, MAX_CONTEXT_ANNOUNCEMENTS).map((a: any) => {
    const preview = (a.content || '').slice(0, MAX_ANNOUNCEMENT_PREVIEW_CHARS);
    const scope = a.department_name ? ` (${a.department_name})` : ' (org-wide)';
    return `- [${a.created_at.toString().slice(0, 10)}]${scope} "${a.title}" by ${a.author_name || 'someone'}: ${preview}`;
  });

  const taskLines = myTasks.slice(0, MAX_CONTEXT_TASKS).map((t: any) =>
    `- "${t.title}" - due ${t.due_date || 'no due date'} - status: ${t.status}${t.assigner_name ? ` - assigned by ${t.assigner_name}` : ''}`
  );

  const eventLines = eventsResult.rows.map((e: any) =>
    `- "${e.title}" - ${new Date(e.starts_at).toISOString().slice(0, 16).replace('T', ' ')}`
  );

  const today = new Date().toISOString().slice(0, 10);
  const context =
    `Today's date is ${today}.\n\n` +
    `COMPANY ANNOUNCEMENTS this person can see (most recent first):\n${announcementLines.join('\n') || '(none)'}\n\n` +
    `THIS PERSON'S OWN TASKS:\n${taskLines.join('\n') || '(none)'}\n\n` +
    `UPCOMING EVENTS:\n${eventLines.join('\n') || '(none)'}`;

  const answer = await callWorkersAI(
    [
      {
        role: 'system',
        content:
          'You answer workplace questions using ONLY the information provided below. If the answer isn\'t in it, say plainly that you don\'t have that information - never guess or invent an answer. Be concise, a sentence or two.\n\n' +
          context,
      },
      { role: 'user', content: trimmed },
    ],
    MAX_ASK_TOKENS
  );
  return answer;
}
