import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';
import { runInBackground } from '../../util/background';

// Simple task tracking: assign a title (+ optional description, due date)
// to someone. Two states only - open/done - no workflow beyond that.
// due_date is a plain DATE (no time), same "one consistent timezone"
// approach events use: shown/compared in SAST regardless of server or
// viewer location.
const SAST = 'Africa/Johannesburg';

// Full shape returned everywhere - assignee/assigner names always
// included, so the client never has to handle a partial task object.
// due_date is cast with TO_CHAR here, not selected bare - the pg driver
// auto-parses a DATE column into a JS Date object, which then serializes
// to a full ISO timestamp ("2026-09-02T00:00:00.000Z") instead of plain
// "2026-09-02". The frontend expects the plain form and builds its own
// datetime string from it (`${dueDate}T00:00:00+02:00`) - fed the
// timestamp form instead, that becomes a malformed double-timestamp
// string that throws "RangeError: Invalid time value" the moment it's
// formatted. Same trap as the calendar month-dots query hit earlier.
async function getTaskFull(taskId: string) {
  const result = await pool.query(
    `SELECT t.id, t.title, t.description, TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, t.status,
            t.assigned_to, t.assigned_by, t.created_at, t.completed_at,
            assignee.full_name AS assignee_name,
            assigner.full_name AS assigner_name
     FROM tasks t
     LEFT JOIN employee_profiles assignee ON assignee.user_id = t.assigned_to
     LEFT JOIN employee_profiles assigner ON assigner.user_id = t.assigned_by
     WHERE t.id = $1`,
    [taskId]
  );
  return result.rows[0];
}

interface CreateTaskInput {
  organizationId: string;
  title: string;
  description?: string;
  assignedTo: string;
  assignedBy: string;
  dueDate?: string; // 'YYYY-MM-DD'
}

export async function createTask(input: CreateTaskInput) {
  const { organizationId, title, description, assignedTo, assignedBy, dueDate } = input;

  const assignee = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
    [assignedTo, organizationId]
  );
  if (assignee.rows.length === 0) {
    throw new Error('ASSIGNEE_NOT_IN_ORG');
  }

  const result = await pool.query(
    `INSERT INTO tasks (organization_id, title, description, assigned_to, assigned_by, due_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organizationId, title, description || null, assignedTo, assignedBy, dueDate || null]
  );
  const taskId = result.rows[0].id;

  // Assigning yourself a task is a normal thing (a personal todo) - no
  // need to notify yourself about your own action.
  if (assignedTo !== assignedBy) {
    runInBackground(createNotification({ userId: assignedTo, type: 'task_assigned', sourceId: taskId }));
  }

  return getTaskFull(taskId);
}

// Tasks assigned TO this person - their personal todo list. Open ones
// first (soonest due date first, undated ones last), then done ones.
export async function listMyTasks(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT t.id, t.title, t.description, TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, t.status,
            t.assigned_to, t.assigned_by, t.created_at, t.completed_at,
            assignee.full_name AS assignee_name,
            assigner.full_name AS assigner_name
     FROM tasks t
     LEFT JOIN employee_profiles assignee ON assignee.user_id = t.assigned_to
     LEFT JOIN employee_profiles assigner ON assigner.user_id = t.assigned_by
     WHERE t.organization_id = $1 AND t.assigned_to = $2
     ORDER BY (t.status = 'done'), (t.due_date IS NULL), t.due_date ASC, t.created_at DESC`,
    [organizationId, userId]
  );
  return result.rows;
}

// Tasks this person has handed to OTHERS - the "tracking" half: keeping
// an eye on progress without having to ask.
export async function listAssignedByMe(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT t.id, t.title, t.description, TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, t.status,
            t.assigned_to, t.assigned_by, t.created_at, t.completed_at,
            assignee.full_name AS assignee_name,
            assigner.full_name AS assigner_name
     FROM tasks t
     LEFT JOIN employee_profiles assignee ON assignee.user_id = t.assigned_to
     LEFT JOIN employee_profiles assigner ON assigner.user_id = t.assigned_by
     WHERE t.organization_id = $1 AND t.assigned_by = $2 AND t.assigned_to <> $2
     ORDER BY (t.status = 'done'), (t.due_date IS NULL), t.due_date ASC, t.created_at DESC`,
    [organizationId, userId]
  );
  return result.rows;
}

// Which due-dates in a given month (SAST) have at least one of MY open
// tasks - dots for the sidebar calendar, same idea (and same TO_CHAR fix
// for the Date-object-vs-string trap) as listEventDatesForMonth.
export async function listTaskDatesForMonth(organizationId: string, userId: string, year: number, month: number) {
  const result = await pool.query(
    `SELECT DISTINCT TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
     FROM tasks
     WHERE organization_id = $1
       AND assigned_to = $2
       AND status = 'open'
       AND due_date IS NOT NULL
       AND EXTRACT(YEAR FROM due_date) = $3
       AND EXTRACT(MONTH FROM due_date) = $4`,
    [organizationId, userId, year, month]
  );
  return result.rows.map((r) => r.due_date);
}

// Open tasks assigned to me that are due today or already overdue (SAST) -
// the "reminder" - computed fresh on every hub load rather than via a
// background job/cron, which this app's architecture doesn't have. Simple
// and always accurate, at the cost of only surfacing when they open the app.
export async function listDueOrOverdue(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT id, title, TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
     FROM tasks
     WHERE organization_id = $1
       AND assigned_to = $2
       AND status = 'open'
       AND due_date IS NOT NULL
       AND due_date <= (now() AT TIME ZONE '${SAST}')::date
     ORDER BY due_date ASC`,
    [organizationId, userId]
  );
  return result.rows;
}

// Assignee marks their own task done/open again. Assigner (or an admin)
// can also toggle it - useful for closing out a task on someone's behalf
// when they've confirmed it's done some other way (in person, in a DM).
export async function setTaskStatus(taskId: string, userId: string, isAdmin: boolean, status: string) {
  if (status !== 'open' && status !== 'done') {
    throw new Error('INVALID_STATUS');
  }
  const existing = await pool.query('SELECT assigned_to, assigned_by FROM tasks WHERE id = $1', [taskId]);
  if (existing.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  const t = existing.rows[0];
  if (t.assigned_to !== userId && t.assigned_by !== userId && !isAdmin) {
    throw new Error('FORBIDDEN');
  }
  await pool.query(
    `UPDATE tasks SET status = $1, completed_at = CASE WHEN $1 = 'done' THEN now() ELSE NULL END
     WHERE id = $2`,
    [status, taskId]
  );
  return getTaskFull(taskId);
}

// Only the assigner (or an admin) can edit the task's substance - the
// assignee can change its status, but not rewrite what they were asked
// to do.
export async function updateTask(
  taskId: string,
  userId: string,
  isAdmin: boolean,
  fields: { title?: string; description?: string; dueDate?: string | null; assignedTo?: string }
) {
  const existing = await pool.query('SELECT assigned_by FROM tasks WHERE id = $1', [taskId]);
  if (existing.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  if (existing.rows[0].assigned_by !== userId && !isAdmin) {
    throw new Error('FORBIDDEN');
  }
  await pool.query(
    `UPDATE tasks SET
       title = COALESCE($1, title),
       description = CASE WHEN $2::text IS NOT NULL THEN NULLIF($2, '') ELSE description END,
       due_date = CASE WHEN $3::text IS NOT NULL THEN NULLIF($3, '')::date ELSE due_date END,
       assigned_to = COALESCE($4, assigned_to)
     WHERE id = $5`,
    [fields.title ?? null, fields.description ?? null, fields.dueDate ?? null, fields.assignedTo ?? null, taskId]
  );
  return getTaskFull(taskId);
}

export async function deleteTask(taskId: string, userId: string, isAdmin: boolean) {
  const existing = await pool.query('SELECT assigned_by FROM tasks WHERE id = $1', [taskId]);
  if (existing.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  if (existing.rows[0].assigned_by !== userId && !isAdmin) {
    throw new Error('FORBIDDEN');
  }
  await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
  return true;
}
