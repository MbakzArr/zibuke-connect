import { Request, Response } from 'express';
import { createEvent, listEventsForDate, listEventDatesForMonth, updateEvent, deleteEvent } from './events.service';

export async function create(req: Request, res: Response) {
  try {
    const { title, startsAt, venue, attendeeIds } = req.body;
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Event title is required' });
    }
    if (!startsAt) {
      return res.status(400).json({ error: 'startsAt is required' });
    }
    const event = await createEvent({
      organizationId: req.user!.organizationId,
      title: title.trim(),
      startsAt,
      venue: venue ? String(venue).trim() : undefined,
      createdBy: req.user!.userId,
      attendeeIds: Array.isArray(attendeeIds) ? attendeeIds : [],
    });
    return res.status(201).json({ event });
  } catch (err) {
    console.error('Create event error:', err);
    return res.status(500).json({ error: 'Could not create event' });
  }
}

// Events for a given date (defaults to today). ?date=YYYY-MM-DD
export async function forDate(req: Request, res: Response) {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const events = await listEventsForDate(req.user!.organizationId, date);
    return res.json({ events });
  } catch (err) {
    console.error('List events error:', err);
    return res.status(500).json({ error: 'Could not load events' });
  }
}

// Dates in a month that have at least one event, for the calendar dots.
// ?year=2026&month=9
export async function month(req: Request, res: Response) {
  try {
    const year = parseInt(String(req.query.year), 10);
    const monthNum = parseInt(String(req.query.month), 10);
    if (!year || !monthNum) {
      return res.status(400).json({ error: 'year and month are required' });
    }
    const dates = await listEventDatesForMonth(req.user!.organizationId, year, monthNum);
    return res.json({ dates });
  } catch (err) {
    console.error('List event dates error:', err);
    return res.status(500).json({ error: 'Could not load calendar' });
  }
}

export async function update(req: Request, res: Response) {
  try {
    const { title, startsAt, venue } = req.body;
    const event = await updateEvent(req.params.id, req.user!.userId, { title, startsAt, venue });
    return res.json({ event });
  } catch (err: any) {
    if (err.message === 'FORBIDDEN') return res.status(403).json({ error: 'Only the organiser can edit this event' });
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Event not found' });
    console.error('Update event error:', err);
    return res.status(500).json({ error: 'Could not update event' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    await deleteEvent(req.params.id, req.user!.userId);
    return res.status(204).send();
  } catch (err: any) {
    if (err.message === 'FORBIDDEN') return res.status(403).json({ error: 'Only the organiser can delete this event' });
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Event not found' });
    console.error('Delete event error:', err);
    return res.status(500).json({ error: 'Could not delete event' });
  }
}
