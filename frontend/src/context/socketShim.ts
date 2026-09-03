import { BASE_URL } from '../api/client';

// CLOUDFLARE-ONLY replacement for socket.io-client (cloudflare branch
// only - the Render/Node frontend still uses real socket.io-client
// unchanged). socket.io the PROTOCOL (not just the server library) isn't
// something the Durable Object backend speaks - it's a plain native
// WebSocket with a tiny {event, data} JSON envelope instead. Rather than
// touch every one of the ~10 files that call socket.emit()/.on()/.off()
// throughout the app, this class replicates just the slice of socket.io-
// client's surface those files actually use, so none of them needed to
// change: .emit(), .on(), .off() (with or without a specific handler),
// and a .connected boolean. Reconnects automatically with backoff, same
// as socket.io-client already did.

type Handler = (...args: any[]) => void;

// The four events this app ever calls .emit() with all share the exact
// same shape: an event name plus a bare channel id string. If that ever
// changes, this is the one place to update, not every call site.
function toWireMessage(event: string, data: unknown): string {
  return JSON.stringify({ type: event, channelId: data });
}

export class SocketShim {
  connected = false;
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Handler>>();
  private token: string;
  private closedByUser = false;
  private reconnectDelayMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private instanceId = Math.random().toString(36).slice(2, 8);

  constructor(token: string) {
    this.token = token;
    console.log(`[SocketShim] NEW INSTANCE ${this.instanceId} created`);
    this.connect();
  }

  private connect() {
    const wsUrl = BASE_URL.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    const connectStartedAt = Date.now();

    ws.onopen = () => {
      this.connected = true;
      this.reconnectDelayMs = 1000; // reset backoff on a successful connect
      console.log(`[SocketShim] ${this.instanceId} OPEN after ${Date.now() - connectStartedAt}ms`);
      this.dispatch('connect', []);
    };

    ws.onclose = (ev) => {
      this.connected = false;
      console.log(`[SocketShim] ${this.instanceId} CLOSE code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean} aliveFor=${Date.now() - connectStartedAt}ms`);
      this.dispatch('disconnect', []);
      if (!this.closedByUser) this.scheduleReconnect();
    };

    ws.onerror = (ev) => {
      // onclose always follows onerror for a WebSocket; the reconnect is
      // scheduled there. Logging here just so an error is visible at all -
      // the WebSocket error event itself carries almost no detail by
      // design (a browser security restriction), so this won't say much
      // more than "there was one", but that's still more than nothing.
      console.log(`[SocketShim] ${this.instanceId} ERROR event fired`, ev);
    };

    ws.onmessage = (ev) => {
      try {
        const { event, data } = JSON.parse(ev.data);
        this.dispatch(event, [data]);
      } catch {
        // ignore anything that isn't the {event, data} envelope
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[SocketShim] ${this.instanceId} scheduling reconnect in ${this.reconnectDelayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, this.reconnectDelayMs);
    // Simple capped exponential backoff - a dropped connection shouldn't
    // hammer the server with immediate, repeated reconnect attempts.
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15000);
  }

  private dispatch(event: string, args: unknown[]) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) handler(...args);
  }

  emit(event: string, data?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(toWireMessage(event, data));
    }
    // If not open yet (still connecting, or between reconnects), this is
    // silently dropped - matches socket.io-client's own buffering-then-
    // giving-up behavior closely enough for what these calls are (join/
    // leave a room, a typing ping) - none of them are things worth
    // queuing and replaying later.
  }

  on(event: string, handler: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  // Matches socket.io-client: off(event, handler) removes just that one
  // listener; off(event) with no handler removes every listener for it.
  off(event: string, handler?: Handler) {
    const set = this.listeners.get(event);
    if (!set) return;
    if (handler) {
      set.delete(handler);
    } else {
      set.clear();
    }
  }

  disconnect() {
    this.closedByUser = true;
    console.log(`[SocketShim] ${this.instanceId} disconnect() called explicitly`);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
