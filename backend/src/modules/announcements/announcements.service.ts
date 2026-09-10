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
  visibleToCandidates?: boolean;
}

export async function listAnnouncements(organizationId: string, departmentId: string | null | undefined, isCandidate = false) {
  // isCandidate short-circuits everything else - a candidate sees ONLY
  // announcements explicitly opted in for them, regardless of department.
  // departmentId === undefined -> no filter at all (full admins see every
  //   announcement across the org, department-scoped or not).
  // departmentId === null -> viewer isn't in any department, so only
  //   org-wide (department_id IS NULL) announcements are visible to them.
  // departmentId === '<uuid>' -> org-wide OR that specific department.
  const params: any[] = [organizationId];
  let deptClause = '';
  if (isCandidate) {
    deptClause = 'AND a.visible_to_candidates = true';
  } else if (departmentId === null) {
    deptClause = 'AND a.department_id IS NULL';
  } else if (departmentId !== undefined) {
    params.push(departmentId);
    deptClause = `AND (a.department_id IS NULL OR a.department_id = $2)`;
  }

  const result = await pool.query(
    `SELECT a.id, a.department_id, a.title, a.content, a.created_by, a.created_at, a.visible_to_candidates,
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
  const { organizationId, departmentId, title, content, createdBy, visibleToCandidates } = input;

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
    `INSERT INTO announcements (organization_id, department_id, title, content, created_by, visible_to_candidates)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, department_id, title, content, created_by, created_at, visible_to_candidates`,
    [organizationId, departmentId || null, title, content, createdBy, Boolean(visibleToCandidates)]
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
  //
  // Candidates aren't modeled as belonging to any department, so a
  // department-scoped audience query would never include them even when
  // visible_to_candidates is set - they're added as an explicit extra
  // group here instead, matching how listAnnouncements treats the flag
  // as its own independent visibility rule, not a department membership.
  // Candidates are users too, so a plain "everyone in the org" or
  // "everyone in this department" query would include them even when
  // visible_to_candidates is false - excluded here explicitly, then added
  // back below only when that flag is actually set. Missing this the
  // first time round was exactly the kind of "live push doesn't match
  // the properly-filtered REST endpoint" bug already fixed once before
  // for department scoping - same mistake, new dimension.
  const audience = departmentId
    ? await pool.query(
        `SELECT id FROM users WHERE organization_id = $1 AND department_id = $2 AND user_type <> 'candidate'`,
        [organizationId, departmentId]
      )
    : await pool.query(`SELECT id FROM users WHERE organization_id = $1 AND user_type <> 'candidate'`, [organizationId]);

  const audienceUserIds = audience.rows.map((r) => r.id);
  if (visibleToCandidates) {
    const candidates = await pool.query(
      `SELECT id FROM users WHERE organization_id = $1 AND user_type = 'candidate'`,
      [organizationId]
    );
    for (const row of candidates.rows) {
      if (!audienceUserIds.includes(row.id)) audienceUserIds.push(row.id);
    }
  }

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
export async function getAnnouncement(organizationId: string, announcementId: string, viewerDepartmentId: string | null | undefined, isCandidate = false) {
  const params: any[] = [organizationId, announcementId];
  let deptClause = '';
  if (isCandidate) {
    deptClause = 'AND a.visible_to_candidates = true';
  } else if (viewerDepartmentId === null) {
    deptClause = 'AND a.department_id IS NULL';
  } else if (viewerDepartmentId !== undefined) {
    params.push(viewerDepartmentId);
    deptClause = `AND (a.department_id IS NULL OR a.department_id = $3)`;
  }
  const result = await pool.query(
    `SELECT a.id, a.department_id, a.title, a.content, a.created_by, a.created_at, a.visible_to_candidates,
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
