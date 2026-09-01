import { Request, Response } from 'express';
import { createEvent, listTodayEvents } from './events.service';

export async function create(req: Request, res: Response) {
  try {
    const { title, startsAt } = req.body;
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Event title is required' });
    }
    if (!startsAt) {
      return res.status(400).json({ error: 'startsAt is required' });
    }
    const event = await createEvent(req.user!.organizationId, title.trim(), startsAt, req.user!.userId);
    return res.status(201).json({ event });
  } catch (err) {
    console.error('Create event error:', err);
    return res.status(500).json({ error: 'Could not create event' });
  }
}

export async function today(req: Request, res: Response) {
  try {
    const events = await listTodayEvents(req.user!.organizationId);
    return res.json({ events });
  } catch (err) {
    console.error('List today events error:', err);
    return res.status(500).json({ error: 'Could not load events' });
  }
}
