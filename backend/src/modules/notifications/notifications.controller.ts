import { Request, Response } from 'express';
import { listNotifications, markRead, markAllRead } from './notifications.service';

export async function list(req: Request, res: Response) {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await listNotifications(req.user!.userId, unreadOnly);
    return res.json({ notifications });
  } catch (err) {
    console.error('List notifications error:', err);
    return res.status(500).json({ error: 'Could not load notifications' });
  }
}

export async function read(req: Request, res: Response) {
  try {
    const ok = await markRead(req.user!.userId, req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json({ read: true });
  } catch (err) {
    console.error('Mark read error:', err);
    return res.status(500).json({ error: 'Could not update notification' });
  }
}

export async function readAll(req: Request, res: Response) {
  try {
    await markAllRead(req.user!.userId);
    return res.json({ read: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    return res.status(500).json({ error: 'Could not update notifications' });
  }
}
