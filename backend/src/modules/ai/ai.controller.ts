import { Request, Response } from 'express';
import { isMember } from '../channels/channels.service';
import { summarizeChannel, rewriteText } from './ai.service';

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

// No membership check here on purpose - unlike summarize, this never
// touches any channel's data. It only ever rewrites text the requester
// already typed themselves, so being a signed-in user (requireAuth, at
// the router level) is the only permission this needs.
export async function rewrite(req: Request, res: Response) {
  try {
    const { text, style } = req.body;
    if (typeof text !== 'string' || typeof style !== 'string') {
      return res.status(400).json({ error: 'text and style are required' });
    }
    const rewritten = await rewriteText(text, style);
    return res.json({ text: rewritten });
  } catch (err: any) {
    if (err.message === 'INVALID_STYLE') {
      return res.status(400).json({ error: 'Unknown rewrite style' });
    }
    if (err.message === 'EMPTY_TEXT') {
      return res.status(400).json({ error: 'Nothing to rewrite yet' });
    }
    if (err.message === 'TOO_LONG') {
      return res.status(400).json({ error: 'That message is too long to rewrite in one go' });
    }
    if (err.message === 'AI_REQUEST_FAILED') {
      return res.status(502).json({ error: 'Could not reach the AI service - try again in a moment.' });
    }
    console.error('Rewrite text error:', err);
    return res.status(500).json({ error: 'Could not rewrite that message' });
  }
}
