import { Server } from 'socket.io';

// A tiny holder for the Socket.io server instance so modules other than
// messaging (announcements, mentions) can push live events without importing
// the whole gateway. The gateway sets this once at startup; everyone else
// reads it. Keeping it here, separate from the gateway wiring, avoids a
// circular import between the gateway and the modules it calls into.

let io: Server | null = null;

export function setIo(instance: Server) {
  io = instance;
}

// Emit an event to a single user across all of their open connections.
// We keep a room per user (named "user:<id>") that every one of their
// sockets joins on connect, so this reaches every device they're on.
export function emitToUser(userId: string, event: string, payload: unknown) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

// Emit an event to everyone currently in a channel's room. Used by webhooks
// to broadcast an externally-posted message the same way a user message is
// delivered.
export function emitToChannel(channelId: string, event: string, payload: unknown) {
  if (!io) return;
  io.to(`channel:${channelId}`).emit(event, payload);
}
