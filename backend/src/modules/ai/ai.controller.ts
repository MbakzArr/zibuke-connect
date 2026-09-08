import { Request, Response } from 'express';
import { isMember } from '../channels/channels.service';
import { summarizeChannel } from './ai.service';

export async function summarize(req: Request, res: Response) {
  try {
    const { channelId, since } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    // Same membership check that gates reading the channel's messages at
    // all - the AI is only ever shown content the requester could already
    // see for themselves.
    const member = await isMember(channelId, req.user!.userId);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this channel' });
    }

    const { summary, messageCount } = await summarizeChannel(channelId, since ?? null);
    return res.json({ summary, messageCount });
  } catch (err: any) {
    if (err.message === 'AI_REQUEST_FAILED') {
      return res.status(502).json({ error: 'Could not reach the AI service - try again in a moment.' });
    }
    console.error('Summarize channel error:', err);
    return res.status(500).json({ error: 'Could not summarize this channel' });
  }
}
