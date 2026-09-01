import { pool } from '../../db/pool';

// A deliberately minimal calendar: title + start time, org-wide, no
// recurrence or per-attendee RSVP. "Today" is always computed in South
// African time (SAST, fixed UTC+2, no daylight saving), regardless of where
// the server or the viewer happens to be, since the brief asks for one
// consistent timezone for now.
const SAST = 'Africa/Johannesburg';

export async function createEvent(organizationId: string, title: string, startsAt: string, createdBy: string) {
  const result = await pool.query(
    `INSERT INTO events (organization_id, title, starts_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, starts_at, created_by, created_at`,
    [organizationId, title, startsAt, createdBy]
  );
  return result.rows[0];
}

// Events whose start time falls on "today" in SAST, earliest first.
export async function listTodayEvents(organizationId: string) {
  const result = await pool.query(
    `SELECT e.id, e.title, e.starts_at, e.created_by, p.full_name AS author_name
     FROM events e
     LEFT JOIN employee_profiles p ON p.user_id = e.created_by
     WHERE e.organization_id = $1
       AND (e.starts_at AT TIME ZONE '${SAST}')::date = (now() AT TIME ZONE '${SAST}')::date
     ORDER BY e.starts_at ASC`,
    [organizationId]
  );
  return result.rows;
}
