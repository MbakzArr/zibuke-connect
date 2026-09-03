import { Request, Response } from 'express';
import { getMessages, editMessage, deleteMessage, restoreMessage, searchMessages, getRecentConversations, createMessage } from './messaging.service';
import { getChannel, isMember, getDmRecipient, getOtherChannelMemberIds } from '../channels/channels.service';
import { processMentions } from './mentions.service';
import { createNotification } from '../notifications/notifications.service';
import { emitToChannel, emitToUser } from './realtime';
import { runInBackground } from '../../util/background';

// REST endpoints for message history and edit/delete. Sending itself was
// socket-only until this endpoint existed - fine on Render, where the
// socket server is always there, but on a deploy target with no socket
// server yet (Cloudflare, pre-Stage-3), that meant sending didn't work at
// ALL, not just "doesn't push live". This does the exact same work the
// socket handler does (membership check, create, mentions, DM
// notification), triggered by a POST instead of a socket event. The
// emitToChannel/emitToUser calls are the same ones the socket path uses -
// they already no-op safely with no socket server attached, so once
// Stage 3 adds one, this same endpoint starts broadcasting live with
// zero further changes needed here.

export async function create(req: Request, res: Response) {
  try {
    const { channelId, content } = req.body;
    if (!content || String(content).trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    const member = await isMember(channelId, req.user!.userId);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this channel' });
    }

    const message = await createMessage({
      channelId,
      userId: req.user!.userId,
      content: String(content).trim(),
    });

    // Same broadcasts the socket handler does - safe no-ops without a
    // live socket server attached (see the module comment above).
    emitToChannel(channelId, 'message:new', message);
    // Every one of these is genuine background work, not just a live
    // push - mentions and DM notifications are real stored rows, not
    // no-ops without a socket. runInBackground() (on Cloudflare) makes
    // sure these actually finish instead of racing the response and
    // sometimes getting cut off - see util/background.ts.
    runInBackground(
      getOtherChannelMemberIds(channelId, req.user!.userId).then((memberIds) => {
        for (const memberId of memberIds) {
          emitToUser(memberId, 'channel:activity', { channelId });
        }
      })
    );
    runInBackground(processMentions(message.id, channelId, req.user!.userId, message.content));
    runInBackground(
      getDmRecipient(channelId, req.user!.userId).then((recipientId) => {
        if (recipientId) {
          return createNotification({ userId: recipientId, type: 'dm', sourceId: message.id });
        }
      })
    );

    return res.status(201).json({ message });
  } catch (err) {
    console.error('Create message error:', err);
    return res.status(500).json({ error: 'Could not send message' });
  }
}

export async function history(req: Request, res: Response) {
  try {
    const channelId = req.params.channelId;

    const channel = await getChannel(req.user!.organizationId, channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Must be a member to read a private channel or DM's history.
    if (channel.is_private || channel.is_dm) {
      const member = await isMember(channelId, req.user!.userId);
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this channel' });
      }
    }

    let limit = parseInt(String(req.query.limit ?? '30'), 10);
    if (isNaN(limit) || limit < 1) limit = 30;
    if (limit > 100) limit = 100;

    const before = req.query.before ? String(req.query.before) : undefined;

    const messages = await getMessages(channelId, limit, before);
    return res.json({ messages });
  } catch (err) {
    console.error('Message history error:', err);
    return res.status(500).json({ error: 'Could not load messages' });
  }
}

export async function edit(req: Request, res: Response) {
  try {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const message = await editMessage(req.params.id, req.user!.userId, content.trim());
    // Broadcast the edit so everyone viewing the channel sees it live.
    emitToChannel(message.channel_id, 'message:updated', message);
    return res.json({ message });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (err.message === 'NOT_AUTHOR') {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }
    if (err.message === 'ALREADY_DELETED') {
      return res.status(400).json({ error: 'This message has been deleted' });
    }
    console.error('Edit message error:', err);
    return res.status(500).json({ error: 'Could not edit message' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const message = await deleteMessage(req.params.id, req.user!.userId);
    // Broadcast the deletion so the masked message updates for everyone live.
    emitToChannel(message.channel_id, 'message:updated', message);
    return res.json({ message });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (err.message === 'NOT_AUTHOR') {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }
    console.error('Delete message error:', err);
    return res.status(500).json({ error: 'Could not delete message' });
  }
}

export async function restore(req: Request, res: Response) {
  try {
    const message = await restoreMessage(req.params.id, req.user!.userId);
    // Broadcast the restore the same way as any other update, so it comes
    // back for everyone viewing the channel, not just the person who
    // clicked Undo.
    emitToChannel(message.channel_id, 'message:updated', message);
    return res.json({ message });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (err.message === 'NOT_AUTHOR') {
      return res.status(403).json({ error: 'You can only restore your own messages' });
    }
    if (err.message === 'NOT_DELETED') {
      return res.status(400).json({ error: 'This message was not deleted' });
    }
    if (err.message === 'UNDO_EXPIRED') {
      return res.status(400).json({ error: 'Too late to undo this delete' });
    }
    console.error('Restore message error:', err);
    return res.status(500).json({ error: 'Could not restore message' });
  }
}

export async function search(req: Request, res: Response) {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    // Optional channelId scopes the search to one channel (in-channel search).
    const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
    const results = await searchMessages(req.user!.userId, q, 30, channelId);
    return res.json({ results });
  } catch (err) {
    console.error('Message search error:', err);
    return res.status(500).json({ error: 'Could not search messages' });
  }
}

export async function recent(req: Request, res: Response) {
  try {
    const conversations = await getRecentConversations(req.user!.userId);
    return res.json({ conversations });
  } catch (err) {
    console.error('Recent conversations error:', err);
    return res.status(500).json({ error: 'Could not load recent conversations' });
  }
}
