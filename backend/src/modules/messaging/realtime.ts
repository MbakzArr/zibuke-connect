import { env, waitUntil } from 'cloudflare:workers';

// CLOUDFLARE WORKERS VERSION of this file (cloudflare branch only - the
// Render/Node version, backed by a live socket.io `Server` instance, is a
// separate, unmodified file). Every OTHER module in this codebase calls
// emitToUser/emitToChannel/broadcastToOrg exactly the same way regardless
// of which version of this file is actually running - only what happens
// INSIDE these three functions differs: the Node version calls
// io.to(room).emit(...) directly; this one POSTs to the single global
// RealtimeRoom Durable Object (see src/durable/RealtimeRoom.ts), which
// then fans the event out to whichever connected WebSockets match that
// room.
//
// That POST is NOT awaited by the caller (a live-push failure should
// never hold up or break the REST response it rode in on - the data is
// already safely saved by the time this runs) - but it still has to be
// registered with waitUntil(), imported directly from cloudflare:workers
// so it's usable from here without threading the request's ExecutionContext
// through every controller that calls emitToChannel/emitToUser/
// broadcastToOrg. Workers' own docs are explicit about why this matters:
// "An async call that is neither awaited nor passed to ctx.waitUntil()
// can be canceled when the invocation ends" - without this, the REST
// response goes out, the request lifecycle ends, and this fetch to the
// Durable Object gets cut off before it ever arrives. That exactly
// matches what was observed: messages/reactions/mentions saved correctly
// (the REST part) but never pushed live (this part, silently cancelled).
function send(room: string, event: string, payload: unknown) {
  const stub = getRoomStub();
  waitUntil(
    stub
      .fetch('https://do/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, event, payload }),
      })
      .then((res) => {
        if (!res.ok) console.error(`Realtime broadcast to ${room} rejected: ${res.status}`);
      })
      .catch((err: unknown) => console.error('Realtime broadcast failed:', err))
  );
}

interface RealtimeEnv {
  REALTIME_ROOM: DurableObjectNamespace;
}

function getRoomStub() {
  const ns = (env as unknown as RealtimeEnv).REALTIME_ROOM;
  const id = ns.idFromName('global');
  return ns.get(id);
}

// Emit an event to a single user across all of their open connections.
// Matches every socket whose attachment has this userId, regardless of
// which channels they've joined.
export function emitToUser(userId: string, event: string, payload: unknown) {
  send(`user:${userId}`, event, payload);
}

// Emit an event to everyone currently viewing a channel (has sent a
// channel:join for it). Used by webhooks too, to broadcast an
// externally-posted message the same way a user message is delivered.
export function emitToChannel(channelId: string, event: string, payload: unknown) {
  send(`channel:${channelId}`, event, payload);
}

// Emit to everyone in an organization - every currently connected socket,
// since this deployment only ever has one org in practice (see
// RealtimeRoom.ts for why one global DO instance is enough).
export function broadcastToOrg(organizationId: string, event: string, payload: unknown) {
  send(`org:${organizationId}`, event, payload);
}
