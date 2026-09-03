import { pool } from '../../db/pool';
import { createMessage } from '../messaging/messaging.service';
import { emitToChannel } from '../messaging/realtime';

// Webhooks let external systems (CI, HR, monitoring) post into a channel
// without a user account. Auth is a per-webhook secret, not a JWT. The
// secret is shown ONCE at creation and only its hash is stored, so a leaked
// database never exposes usable tokens.
//
// Uses the Web Crypto API (globalThis.crypto), not Node's `crypto` module -
// on the Workers runtime this is the one guaranteed-native primitive with
// no dependency on the nodejs_compat shim's completeness for the specific
// functions used here, and no @types/node vs @cloudflare/workers-types
// typing conflict. It's also just standard web platform API, so this same
// code would work unmodified in a browser or any other JS runtime too.

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Hash a token the same way every time so we can look it up by hash.
// subtle.digest is async (the one real API-shape difference from Node's
// synchronous crypto.createHash), so this and everywhere it's called
// needed `await` added.
async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface CreateWebhookInput {
  organizationId: string;
  channelId: string;
  label: string;
  createdBy: string;
}

// Create a webhook for a channel. Returns the RAW token exactly once; after
// this it can't be recovered, only regenerated.
export async function createWebhook(input: CreateWebhookInput) {
  const { organizationId, channelId, label, createdBy } = input;

  // Confirm the channel belongs to this org before attaching a webhook.
  const channel = await pool.query(
    'SELECT id FROM channels WHERE id = $1 AND organization_id = $2',
    [channelId, organizationId]
  );
  if (channel.rows.length === 0) {
    throw new Error('CHANNEL_NOT_IN_ORG');
  }

  // A long random token, prefixed so it's recognisable in logs/config.
  const rawToken = 'whk_' + randomHex(24);
  const tokenHash = await hashToken(rawToken);

  const result = await pool.query(
    `INSERT INTO webhook_tokens (organization_id, channel_id, label, token_hash, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, channel_id, label, created_at`,
    [organizationId, channelId, label, tokenHash, createdBy]
  );

  return { webhook: result.rows[0], token: rawToken };
}

export async function listWebhooks(organizationId: string) {
  const result = await pool.query(
    `SELECT w.id, w.channel_id, w.label, w.created_at, w.last_used_at, c.name AS channel_name
     FROM webhook_tokens w
     JOIN channels c ON c.id = w.channel_id
     WHERE w.organization_id = $1
     ORDER BY w.created_at DESC`,
    [organizationId]
  );
  return result.rows;
}

export async function deleteWebhook(organizationId: string, webhookId: string) {
  const result = await pool.query(
    'DELETE FROM webhook_tokens WHERE id = $1 AND organization_id = $2 RETURNING id',
    [webhookId, organizationId]
  );
  return result.rows.length > 0;
}

// The actual inbound webhook: given a raw token and a text body, look up the
// webhook by token hash, post the message to its channel, and broadcast it
// live just like a user message. Returns the created message or throws.
export async function postViaWebhook(rawToken: string, content: string) {
  const tokenHash = await hashToken(rawToken);

  const result = await pool.query(
    `SELECT id, channel_id, organization_id FROM webhook_tokens WHERE token_hash = $1`,
    [tokenHash]
  );
  const webhook = result.rows[0];
  if (!webhook) {
    throw new Error('INVALID_TOKEN');
  }

  // Record usage for auditing.
  await pool.query('UPDATE webhook_tokens SET last_used_at = now() WHERE id = $1', [webhook.id]);

  // Post as a message. Webhook messages are attributed to the webhook's
  // creator conceptually, but to keep it simple and honest we store them
  // under a system sender. Here we reuse createMessage with the channel's
  // org system; for the demo we attribute to the webhook creator.
  const creatorResult = await pool.query(
    'SELECT created_by FROM webhook_tokens WHERE id = $1',
    [webhook.id]
  );
  const senderId = creatorResult.rows[0].created_by;

  const message = await createMessage({
    channelId: webhook.channel_id,
    userId: senderId,
    content,
  });

  // Broadcast live to anyone in the channel, same as a normal message.
  emitToChannel(webhook.channel_id, 'message:new', message);

  return message;
}
