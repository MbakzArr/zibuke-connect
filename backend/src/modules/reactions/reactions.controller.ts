import { Request, Response } from 'express';
import { toggleReaction, getReactions, ALLOWED_EMOJI } from './reactions.service';
import { broadcastToOrg, emitToChannel } from '../messaging/realtime';
import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';
import { runInBackground } from '../../util/background';

// Look up which channel a message belongs to, so a message reaction can be
// broadcast to just that channel's members.
async function getChannelIdForMessage(messageId: string): Promise<string | null> {
  const r = await pool.query('SELECT channel_id FROM messages WHERE id = $1', [messageId]);
  return r.rows[0]?.channel_id || null;
}

// Who should be notified that their thing got a reaction: the message's
// sender, the announcement's author, or - for a birthday - the birthday
// person themselves (target_id IS a user id in that case, not a separate
// row to look up an owner from).
async function getTargetOwnerId(targetType: string, targetId: string): Promise<string | null> {
  if (targetType === 'birthday') return targetId;
  if (targetType === 'message') {
    const r = await pool.query('SELECT user_id FROM messages WHERE id = $1', [targetId]);
    return r.rows[0]?.user_id ?? null;
  }
  if (targetType === 'announcement') {
    const r = await pool.query('SELECT created_by FROM announcements WHERE id = $1', [targetId]);
    return r.rows[0]?.created_by ?? null;
  }
  return null;
}

export async function toggle(req: Request, res: Response) {
  try {
    const { targetType, targetId, emoji } = req.body;
    if (!targetType || !targetId || !emoji) {
      return res.status(400).json({ error: 'targetType, targetId and emoji are required' });
    }
    if (targetType !== 'announcement' && targetType !== 'birthday' && targetType !== 'message') {
      return res.status(400).json({ error: 'Invalid targetType' });
    }
    const result = await toggleReaction(
      req.user!.organizationId,
      req.user!.userId,
      targetType,
      targetId,
      emoji
    );
    // Broadcast fresh counts so other clients update live.
    const counts = await getReactions(
      req.user!.organizationId,
      req.user!.userId,
      targetType,
      [targetId]
    );
    const payload = { targetType, targetId, counts: counts[targetId] || {} };

    if (targetType === 'message') {
      // A message reaction is only relevant to that message's channel, so
      // broadcast to the channel room, not the whole org.
      const channelId = await getChannelIdForMessage(targetId);
      if (channelId) emitToChannel(channelId, 'reaction:update', payload);
    } else {
      // Announcements/birthdays are org-wide surfaces.
      broadcastToOrg(req.user!.organizationId, 'reaction:update', payload);
    }

    // Notify whoever owns the thing being reacted to - only on adding a
    // reaction (removing one isn't news worth a notification), and never
    // notify someone for reacting to their own message/post/birthday.
    // This never existed before at all - reactions only ever broadcast
    // live counts, nobody got told they'd been reacted to.
    if (result.status === 'added' && result.reactionId) {
      runInBackground(
        (async () => {
          const ownerId = await getTargetOwnerId(targetType, targetId);
          if (ownerId && ownerId !== req.user!.userId) {
            await createNotification({ userId: ownerId, type: 'reaction', sourceId: result.reactionId! });
          }
        })()
      );
    }

    return res.json({ status: result.status });
  } catch (err: any) {
    if (err.message === 'INVALID_EMOJI') {
      return res.status(400).json({ error: 'That reaction is not allowed' });
    }
    console.error('Toggle reaction error:', err);
    return res.status(500).json({ error: 'Could not update reaction' });
  }
}

export async function listForTargets(req: Request, res: Response) {
  try {
    const targetType = String(req.query.targetType ?? '');
    if (targetType !== 'announcement' && targetType !== 'birthday' && targetType !== 'message') {
      return res.status(400).json({ error: 'Invalid targetType' });
    }
    // targetIds passed as a comma-separated list.
    const raw = String(req.query.targetIds ?? '').trim();
    const targetIds = raw ? raw.split(',') : [];
    const reactions = await getReactions(
      req.user!.organizationId,
      req.user!.userId,
      targetType,
      targetIds
    );
    return res.json({ reactions, allowed: ALLOWED_EMOJI });
  } catch (err) {
    console.error('List reactions error:', err);
    return res.status(500).json({ error: 'Could not load reactions' });
  }
}
