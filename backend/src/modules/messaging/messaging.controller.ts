import { Request, Response } from 'express';
import { getMessages, editMessage, deleteMessage } from './messaging.service';
import { getChannel, isMember } from '../channels/channels.service';

// REST endpoints for message history and edit/delete. Live sending happens
// over the socket, but history loading and edits work over plain HTTP so
// the client can page back through old messages and edit without depending
// on the socket connection.

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
