import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';

// A deliberately minimal calendar: title + start time + optional venue, and
// optional invited attendees. No recurrence, no RSVP status. "Today"/dates
// are always computed in South African time (SAST, fixed UTC+2, no
// daylight saving), regardless of where the server or the viewer happens to
// be, since the brief asks for one consistent timezone for now.
const SAST = 'Africa/Johannesburg';

// Shared shape: every event returned to the client always has the same
// fields (author_name, attendee_names included), whether it just got
// created or is being listed. Returning a partial shape from create() was
// the actual cause of a blank-page crash - the UI always expects
// attendee_names to be an array.
async function getEventFull(eventId: string) {
  const result = await pool.query(
    `SELECT e.id, e.title, e.starts_at, e.venue, e.created_by,
            p.full_name AS author_name,
            COALESCE(
              (SELECT array_agg(ap.full_name ORDER BY ap.full_name)
               FROM event_attendees ea
               JOIN employee_profiles ap ON ap.user_id = ea.user_id
               WHERE ea.event_id = e.id),
              ARRAY[]::text[]
            ) AS attendee_names
     FROM events e
     LEFT JOIN employee_profiles p ON p.user_id = e.created_by
     WHERE e.id = $1`,
    [eventId]
  );
  return result.rows[0];
}

interface CreateEventInput {
  organizationId: string;
  title: string;
  startsAt: string;
  venue?: string;
  createdBy: string;
  attendeeIds?: string[];
}

export async function createEvent(input: CreateEventInput) {
  const { organizationId, title, startsAt, venue, createdBy, attendeeIds = [] } = input;

  const client = await pool.connect();
  let eventId: string;
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO events (organization_id, title, starts_at, venue, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [organizationId, title, startsAt, venue || null, createdBy]
    );
    eventId = result.rows[0].id;

    // The creator is always implicitly an attendee, plus anyone they invited.
    const allAttendees = Array.from(new Set([createdBy, ...attendeeIds]));
    for (const userId of allAttendees) {
      await client.query(
        `INSERT INTO event_attendees (event_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eventId, userId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Notify invited people (not the creator, they already know). Reuses
  // the existing notifications system with a new 'event' type - no schema
  // change needed there, notifications.type has no fixed set of values.
  for (const userId of attendeeIds) {
    if (userId !== createdBy) {
      createNotification({ userId, type: 'event', sourceId: eventId }).catch((err) =>
        console.error('Event invite notification failed:', err)
      );
    }
  }

  // Always return the FULL shape (same query listEventsForDate uses), so
  // the client never gets a partial object.
  return getEventFull(eventId);
}

// Events whose start time falls on a given date in SAST (defaults to
// today), earliest first, each with its venue and attendee names.
export async function listEventsForDate(organizationId: string, date?: string) {
  const dateExpr = date ? `$2::date` : `(now() AT TIME ZONE '${SAST}')::date`;
  const params = date ? [organizationId, date] : [organizationId];

  const result = await pool.query(
    `SELECT e.id, e.title, e.starts_at, e.venue, e.created_by,
            p.full_name AS author_name,
            COALESCE(
              (SELECT array_agg(ap.full_name ORDER BY ap.full_name)
               FROM event_attendees ea
               JOIN employee_profiles ap ON ap.user_id = ea.user_id
               WHERE ea.event_id = e.id),
              ARRAY[]::text[]
            ) AS attendee_names
     FROM events e
     LEFT JOIN employee_profiles p ON p.user_id = e.created_by
     WHERE e.organization_id = $1
       AND (e.starts_at AT TIME ZONE '${SAST}')::date = ${dateExpr}
     ORDER BY e.starts_at ASC`,
    params
  );
  return result.rows;
}

// Which dates in a given month (SAST) have at least one event - just the
// dates, for marking dots on a calendar widget without fetching every event.
// Cast to text with TO_CHAR here, not just ::date - the pg driver parses a
// bare DATE column into a JS Date object, which then serializes to a full
// ISO timestamp ("2026-09-17T00:00:00.000Z") instead of "2026-09-17". The
// frontend compares against a plain "YYYY-MM-DD" string, so that mismatch
// silently meant no dot ever matched and the calendar looked empty.
export async function listEventDatesForMonth(organizationId: string, year: number, month: number) {
  const result = await pool.query(
    `SELECT DISTINCT TO_CHAR(starts_at AT TIME ZONE '${SAST}', 'YYYY-MM-DD') AS event_date
     FROM events
     WHERE organization_id = $1
       AND EXTRACT(YEAR FROM starts_at AT TIME ZONE '${SAST}') = $2
       AND EXTRACT(MONTH FROM starts_at AT TIME ZONE '${SAST}') = $3`,
    [organizationId, year, month]
  );
  return result.rows.map((r) => r.event_date);
}

// Only the event's creator may edit or delete it.
async function assertOwner(eventId: string, userId: string) {
  const r = await pool.query('SELECT created_by FROM events WHERE id = $1', [eventId]);
  if (r.rows.length === 0) throw new Error('NOT_FOUND');
  if (r.rows[0].created_by !== userId) throw new Error('FORBIDDEN');
}

export async function updateEvent(
  eventId: string,
  userId: string,
  fields: { title?: string; startsAt?: string; venue?: string }
) {
  await assertOwner(eventId, userId);
  await pool.query(
    `UPDATE events SET
       title = COALESCE($1, title),
       starts_at = COALESCE($2, starts_at),
       venue = $3
     WHERE id = $4`,
    [fields.title ?? null, fields.startsAt ?? null, fields.venue ?? null, eventId]
  );
  return getEventFull(eventId);
}

export async function deleteEvent(eventId: string, userId: string) {
  await assertOwner(eventId, userId);
  await pool.query('DELETE FROM events WHERE id = $1', [eventId]);
  return true;
}
