import { Request, Response } from 'express';
import { toggleReaction, getReactions, ALLOWED_EMOJI } from './reactions.service';

export async function toggle(req: Request, res: Response) {
  try {
    const { targetType, targetId, emoji } = req.body;
    if (!targetType || !targetId || !emoji) {
      return res.status(400).json({ error: 'targetType, targetId and emoji are required' });
    }
    if (targetType !== 'announcement' && targetType !== 'birthday') {
      return res.status(400).json({ error: 'Invalid targetType' });
    }
    const result = await toggleReaction(
      req.user!.organizationId,
      req.user!.userId,
      targetType,
      targetId,
      emoji
    );
    return res.json({ status: result });
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
    if (targetType !== 'announcement' && targetType !== 'birthday') {
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
