import { DurableObject } from 'cloudflare:workers';
import { verifyAccessToken } from '../modules/auth/tokens';
import { pool } from '../db/pool';

// CLOUDFLARE-ONLY replacement for Socket.io (cloudflare branch only - the
// Render/Node backend still uses socketGateway.ts + socket.io unchanged).
// Socket.io the library doesn't run on Workers (no persistent Node
// process for it to hold state in); the actual Cloudflare-native answer
// for "many people need to stay connected and get pushed live events" is
// a Durable Object using the WebSocket Hibernation API.
//
// Design: ONE global instance handles the whole deployment (this app is
// single-organization in practice, so per-org sharding would just be
// complexity with no real benefit here). Every connected browser holds
// one WebSocket to this same DO instance. The REST API (wherever it
// currently calls emitToChannel/emitToUser/broadcastToOrg) POSTs an
// internal /broadcast request to this DO instead of using socket.io's
// io.to(room).emit(...) - same three "rooms" (channel:<id>, user:<id>,
// org:<id>), just fanned out here instead.
//
// Hibernation matters because a DO does NOT keep running (or get billed)
// for an idle open connection - the runtime can evict it from memory
// between messages and wake it back up on demand. That means normal
// instance fields (a Map in memory) do NOT survive between wakeups. Per-
// connection identity (who is this socket, which channels have they
// joined) is instead stored via ws.serializeAttachment(), which DOES
// survive hibernation, and read back via ws.deserializeAttachment() -
// this is the Cloudflare-documented pattern for exactly this situation,
// not a workaround.

interface SocketAttachment {
  userId: string;
  organizationId: string;
  joinedChannels: string[];
}

export class RealtimeRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    // The actual root cause of flaky presence/live-updates: Cloudflare's
    // edge enforces a 100-second idle timeout on WebSocket connections
    // (Free/Pro plans - not adjustable), and this app never sent any
    // traffic during a quiet channel, so the connection would silently
    // die and reconnect every ~100s, showing as a presence flicker each
    // time. setWebSocketAutoResponse tells the RUNTIME ITSELF to answer
    // a "ping" with "pong" directly - the DO is never woken to handle
    // it (so this costs nothing and doesn't interrupt hibernation), but
    // it's still real traffic on the connection, which is what actually
    // resets Cloudflare's idle timer. Set in the constructor (not just
    // once elsewhere) because the constructor re-runs every time the DO
    // wakes from hibernation, and this needs to be armed again each time.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal call from the REST API (same worker script, not exposed
    // publicly) telling this DO to fan an event out to matching sockets.
    if (url.pathname === '/broadcast') {
      const { room, event, payload } = await request.json() as { room: string; event: string; payload: unknown };
      console.log(`[RealtimeRoom] /broadcast received: room=${room} event=${event}`);
      this.broadcast(room, event, payload);
      return new Response(null, { status: 204 });
    }

    // Everything else is the actual WebSocket upgrade from a browser.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    // Auth: verify the same access token used for every REST request.
    // WebSocket handshakes from a browser can't carry a custom
    // Authorization header the way fetch() can, so the token travels as
    // a query param instead - same token, just a different transport for
    // this one request.
    const token = url.searchParams.get('token');
    if (!token) {
      return new Response('Missing token', { status: 401 });
    }
    let userId: string;
    let organizationId: string;
    try {
      const payload = verifyAccessToken(token);
      userId = payload.userId;
      organizationId = payload.organizationId;
    } catch {
      return new Response('Invalid or expired token', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // IMPORTANT: acceptWebSocket FIRST, then check existing sockets,
    // and exclude THIS socket when checking. The DO's WebSocket list
    // only includes sockets after acceptWebSocket() is called - but once
    // it IS called, this new socket is immediately in the list. So we
    // check getWebSockets() AFTER accept and exclude `server` itself.
    // Previously the code called getWebSockets() BEFORE acceptWebSocket,
    // meaning this new socket wasn't in the list yet but dead stale
    // sockets from the previous connection cycle WERE - causing
    // alreadyOnline=true incorrectly and willMarkOnline=false every time.
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { userId, organizationId, joinedChannels: [] };
    server.serializeAttachment(attachment);

    // Presence: mark the user online if this is their FIRST open
    // connection (they could have more than one - another tab, a phone).
    const allSockets = this.ctx.getWebSockets();
    const alreadyOnline = allSockets.some((s) => {
      if (s === server) return false; // exclude this socket itself
      const a = s.deserializeAttachment() as SocketAttachment | null;
      return a?.userId === userId;
    });
    const existingCount = allSockets.filter((s) => s !== server && (s.deserializeAttachment() as SocketAttachment | null)?.userId === userId).length;
    console.log(`[RealtimeRoom] CONNECT userId=${userId} existingSocketsForThisUser=${existingCount} totalAfterAccept=${allSockets.length} willMarkOnline=${!alreadyOnline}`);
    if (!alreadyOnline) {
      await pool.query(`UPDATE users SET status = 'online', last_seen_at = now() WHERE id = $1`, [userId]);
      this.broadcastToEveryone('presence:update', { userId, status: 'online' });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called by the runtime when a message arrives on a hibernating (or
  // live) socket - this is what actually wakes the DO back up if it had
  // been evicted.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    let msg: { type: string; channelId?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment;
    if (!attachment) return;

    if (msg.type === 'channel:join' && msg.channelId) {
      if (!attachment.joinedChannels.includes(msg.channelId)) {
        attachment.joinedChannels.push(msg.channelId);
        ws.serializeAttachment(attachment);
      }
      console.log(`[RealtimeRoom] channel:join userId=${attachment.userId} channelId=${msg.channelId} nowJoined=${JSON.stringify(attachment.joinedChannels)}`);
      return;
    }

    if (msg.type === 'channel:leave' && msg.channelId) {
      attachment.joinedChannels = attachment.joinedChannels.filter((c) => c !== msg.channelId);
      ws.serializeAttachment(attachment);
      return;
    }

    if ((msg.type === 'typing:start' || msg.type === 'typing:stop') && msg.channelId) {
      // The client only ever sends the channel id, not a name - the
      // original socket.io handler resolved the typer's display name
      // server-side too, so this matches that rather than expecting a
      // client-supplied name that was never actually sent.
      const name = await this.getUserName(attachment.userId);
      // Broadcast directly to the channel's other sockets - typing status
      // is purely ephemeral, never persisted, so this doesn't go through
      // the same /broadcast path the REST API uses (there's no REST
      // controller involved in a typing indicator at all).
      this.broadcast(
        `channel:${msg.channelId}`,
        'typing:update',
        { channelId: msg.channelId, userId: attachment.userId, name, typing: msg.type === 'typing:start' },
        ws // exclude the sender - you don't need your own typing echoed back
      );
    }
  }

  private async getUserName(userId: string): Promise<string> {
    const r = await pool.query('SELECT full_name FROM employee_profiles WHERE user_id = $1', [userId]);
    return r.rows[0]?.full_name || 'Someone';
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    console.log(`[RealtimeRoom] CLOSE userId=${attachment?.userId ?? 'unknown'} code=${code} reason=${reason} wasClean=${wasClean}`);
    try {
      ws.close(code, reason);
    } catch {
      // already closing/closed, nothing further to do
    }

    // Mark offline only if that was their LAST open connection - closing
    // one tab while another is still open (or a phone alongside a
    // laptop) shouldn't flip them to offline.
    if (attachment) {
      const remaining = this.ctx.getWebSockets();
      const stillOnline = remaining.some((s) => {
        if (s === ws) return false;
        const a = s.deserializeAttachment() as SocketAttachment | null;
        return a?.userId === attachment.userId;
      });
      console.log(`[RealtimeRoom] CLOSE userId=${attachment.userId} remainingSocketsTotal=${remaining.length} stillOnline=${stillOnline}`);
      if (!stillOnline) {
        await pool.query(`UPDATE users SET status = 'offline', last_seen_at = now() WHERE id = $1`, [attachment.userId]);
        this.broadcastToEveryone('presence:update', { userId: attachment.userId, status: 'offline' });
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    console.log(`[RealtimeRoom] ERROR userId=${attachment?.userId ?? 'unknown'} error=${String(error)}`);
    // Same offline bookkeeping as a normal close - an abnormal
    // termination still means this connection is gone, and the runtime
    // does not guarantee webSocketClose also fires after webSocketError.
    if (attachment) {
      const remaining = this.ctx.getWebSockets();
      const stillOnline = remaining.some((s) => {
        if (s === ws) return false;
        const a = s.deserializeAttachment() as SocketAttachment | null;
        return a?.userId === attachment.userId;
      });
      console.log(`[RealtimeRoom] ERROR userId=${attachment.userId} remainingSocketsTotal=${remaining.length} stillOnline=${stillOnline}`);
      if (!stillOnline) {
        await pool.query(`UPDATE users SET status = 'offline', last_seen_at = now() WHERE id = $1`, [attachment.userId]);
        this.broadcastToEveryone('presence:update', { userId: attachment.userId, status: 'offline' });
      }
    }
  }

  // Presence updates go to literally everyone connected, not one of the
  // three room kinds - socket.io's version used a bare io.emit() for the
  // same reason (anyone's online/offline status can matter to anyone
  // else viewing the directory or people-online list).
  private broadcastToEveryone(event: string, payload: unknown) {
    const data = JSON.stringify({ event, data: payload });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket died between the snapshot and send(); nothing to do
      }
    }
  }

  // Fan an event out to every currently-connected socket whose
  // attachment matches this room. getWebSockets() returns every accepted
  // socket for this DO instance regardless of hibernation state - the
  // runtime transparently wakes a hibernating one when send() is called
  // on it.
  private broadcast(room: string, event: string, payload: unknown, exclude?: WebSocket) {
    const [kind, id] = room.split(':', 2);
    const data = JSON.stringify({ event, data: payload });

    const sockets = this.ctx.getWebSockets();
    let matchCount = 0;
    for (const ws of sockets) {
      if (ws === exclude) continue;
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;

      const matches =
        (kind === 'user' && attachment.userId === id) ||
        (kind === 'org' && attachment.organizationId === id) ||
        (kind === 'channel' && attachment.joinedChannels.includes(id));

      if (matches) {
        matchCount++;
        try {
          ws.send(data);
        } catch {
          // socket died between the getWebSockets() snapshot and send();
          // nothing to do, the runtime will clean it up
        }
      }
    }
    // Temporary diagnostic (safe to remove once real-time is confirmed
    // solid) - visible via `wrangler tail`. If totalSockets is 0, this
    // instance genuinely has no one connected. If matched stays 0 with
    // sockets > 0, the room-matching logic itself is the problem, not
    // delivery.
    console.log(`[RealtimeRoom] broadcast room=${room} event=${event} totalSockets=${sockets.length} matched=${matchCount}`);
  }
}
