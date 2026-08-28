import { Server } from 'socket.io';
import http from 'http';
import { socketAuth, AuthedSocket } from './socketAuth';
import { markOnline, markOffline } from './presence.service';
import { createMessage } from './messaging.service';
import { processMentions } from './mentions.service';
import { getChannel, isMember } from '../channels/channels.service';
import { setIo } from './realtime';

// Wires Socket.io onto the existing HTTP server. Real-time flow:
//   - client connects with a token, we authenticate the handshake
//   - client emits "channel:join" with a channelId; we verify membership,
//     then add the socket to a room named after the channel
//   - client emits "message:send"; we save it, then broadcast to everyone
//     in that channel's room, so all members see it instantly
//   - typing indicators are broadcast but never stored
//   - presence is updated on connect/disconnect and broadcast org-wide

export function attachSocketServer(httpServer: http.Server) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // tighten to the frontend origin in production
  });

  io.use(socketAuth);

  // Make the io instance available to other modules (announcements, mentions)
  // so they can push live notifications without importing this gateway.
  setIo(io);

  io.on('connection', async (socket: AuthedSocket) => {
    const user = socket.user!;

    // Every one of a user's sockets joins a room named after their user id,
    // so a notification can be delivered to all their devices at once.
    socket.join(`user:${user.userId}`);

    await markOnline(user.userId);

    // Tell everyone in this org that the user came online.
    io.emit('presence:update', { userId: user.userId, status: 'online' });

    // Join a channel's live room, only if the user is really a member.
    socket.on('channel:join', async (channelId: string, ack?: (res: any) => void) => {
      try {
        const channel = await getChannel(user.organizationId, channelId);
        if (!channel) {
          return ack?.({ error: 'Channel not found' });
        }
        const member = await isMember(channelId, user.userId);
        if (!member && (channel.is_private || channel.is_dm)) {
          return ack?.({ error: 'Not a member of this channel' });
        }
        socket.join(`channel:${channelId}`);
        ack?.({ joined: true });
      } catch (err) {
        ack?.({ error: 'Could not join channel' });
      }
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Send a message. Saved to the DB, then pushed live to the room.
    socket.on('message:send', async (
      payload: { channelId: string; content: string },
      ack?: (res: any) => void
    ) => {
      try {
        const { channelId, content } = payload;
        if (!content || content.trim().length === 0) {
          return ack?.({ error: 'Message cannot be empty' });
        }

        // Re-check membership on every send; a socket joined earlier could
        // have been removed from the channel since.
        const member = await isMember(channelId, user.userId);
        if (!member) {
          return ack?.({ error: 'You are not a member of this channel' });
        }

        const message = await createMessage({
          channelId,
          userId: user.userId,
          content: content.trim(),
        });

        // Broadcast to everyone currently in the room, including the sender,
        // so all clients render the same server-authoritative message.
        io.to(`channel:${channelId}`).emit('message:new', message);

        // Handle any @mentions: record them and notify the mentioned members.
        // Done after the broadcast so message delivery is never held up by
        // mention processing.
        processMentions(message.id, channelId, user.userId, message.content)
          .catch((err) => console.error('Mention processing failed:', err));

        ack?.({ sent: true, message });
      } catch (err) {
        ack?.({ error: 'Could not send message' });
      }
    });

    // Typing indicator, broadcast to others in the room, never persisted.
    socket.on('typing:start', (channelId: string) => {
      socket.to(`channel:${channelId}`).emit('typing:update', {
        channelId,
        userId: user.userId,
        typing: true,
      });
    });

    socket.on('typing:stop', (channelId: string) => {
      socket.to(`channel:${channelId}`).emit('typing:update', {
        channelId,
        userId: user.userId,
        typing: false,
      });
    });

    socket.on('disconnect', async () => {
      await markOffline(user.userId);
      // Only announce offline if this was their last connection.
      const { isOnline } = await import('./presence.service');
      if (!isOnline(user.userId)) {
        io.emit('presence:update', { userId: user.userId, status: 'offline' });
      }
    });
  });

  return io;
}
