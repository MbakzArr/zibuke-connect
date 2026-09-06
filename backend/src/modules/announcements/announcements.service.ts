import { pool } from '../../db/pool';
import { createNotificationsForMany } from '../notifications/notifications.service';

// Announcements are the "replace the all-staff email" feature. An admin (or
// department admin) posts one, optionally scoped to a department, and
// everyone in the audience gets a notification. This is what powers Anja's
// "celebrate wins, birthdays, trivia" use case.

interface CreateAnnouncementInput {
  organizationId: string;
  departmentId?: string | null;
  title: string;
  content: string;
  createdBy: string;
}

export async function listAnnouncements(organizationId: string, departmentId: string | null | undefined) {
  // departmentId === undefined -> no filter at all (full admins see every
  //   announcement across the org, department-scoped or not).
  // departmentId === null -> viewer isn't in any department, so only
  //   org-wide (department_id IS NULL) announcements are visible to them.
  // departmentId === '<uuid>' -> org-wide OR that specific department.
  const params: any[] = [organizationId];
  let deptClause = '';
  if (departmentId === null) {
    deptClause = 'AND a.department_id IS NULL';
  } else if (departmentId !== undefined) {
    params.push(departmentId);
    deptClause = `AND (a.department_id IS NULL OR a.department_id = $2)`;
  }

  const result = await pool.query(
    `SELECT a.id, a.department_id, a.title, a.content, a.created_by, a.created_at,
            d.name AS department_name,
            p.full_name AS author_name
     FROM announcements a
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN employee_profiles p ON p.user_id = a.created_by
     WHERE a.organization_id = $1
       ${deptClause}
     ORDER BY a.created_at DESC
     LIMIT 50`,
    params
  );
  return result.rows;
}

export async function createAnnouncement(input: CreateAnnouncementInput) {
  const { organizationId, departmentId, title, content, createdBy } = input;

  // If scoped to a department, confirm it belongs to this org.
  if (departmentId) {
    const dept = await pool.query(
      'SELECT id FROM departments WHERE id = $1 AND organization_id = $2',
      [departmentId, organizationId]
    );
    if (dept.rows.length === 0) {
      throw new Error('DEPARTMENT_NOT_IN_ORG');
    }
  }

  const result = await pool.query(
    `INSERT INTO announcements (organization_id, department_id, title, content, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, department_id, title, content, created_by, created_at`,
    [organizationId, departmentId || null, title, content, createdBy]
  );
  const announcement = result.rows[0];

  // Work out the audience: org-wide hits everyone in the org, department-
  // scoped hits only that department's members. This same list drives BOTH
  // the live push and the notifications - it has to match the REST
  // endpoints' filtering exactly, or a department-scoped announcement can
  // leak to people outside it over the live socket push even though the
  // REST list/detail endpoints correctly hide it from them. (Includes the
  // author, so their own post appears live for them too - filtered out
  // below just for notifications, since you don't need to be notified of
  // your own post.)
  const audience = departmentId
    ? await pool.query(
        `SELECT id FROM users WHERE organization_id = $1 AND department_id = $2`,
        [organizationId, departmentId]
      )
    : await pool.query(`SELECT id FROM users WHERE organization_id = $1`, [organizationId]);

  const audienceUserIds = audience.rows.map((r) => r.id);
  const notifyUserIds = audienceUserIds.filter((id) => id !== createdBy);
  await createNotificationsForMany(notifyUserIds, 'announcement', announcement.id);

  return { announcement, audienceUserIds };
}

// Fetch a single announcement by id, scoped to the caller's org AND their
// visibility (same rule as the list: org-wide always visible, department-
// scoped only to that department, unless the viewer is a full admin).
// Without this check, anyone who had (or guessed) an announcement's id
// could read a department-only one directly, bypassing the list filter
// entirely - the id itself carries no authorization on its own.
export async function getAnnouncement(organizationId: string, announcementId: string, viewerDepartmentId: string | null | undefined) {
  const params: any[] = [organizationId, announcementId];
  let deptClause = '';
  if (viewerDepartmentId === null) {
    deptClause = 'AND a.department_id IS NULL';
  } else if (viewerDepartmentId !== undefined) {
    params.push(viewerDepartmentId);
    deptClause = `AND (a.department_id IS NULL OR a.department_id = $3)`;
  }
  const result = await pool.query(
    `SELECT a.id, a.department_id, a.title, a.content, a.created_by, a.created_at,
            d.name AS department_name,
            p.full_name AS author_name
     FROM announcements a
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN employee_profiles p ON p.user_id = a.created_by
     WHERE a.organization_id = $1 AND a.id = $2
       ${deptClause}`,
    params
  );
  return result.rows[0] || null;
}
