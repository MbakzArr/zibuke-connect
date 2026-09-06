import { pool } from '../../db/pool';

// The directory is how employees find each other without email. It reads
// from employee_profiles, but deliberately never selects national_id_number
// here, that sensitive field is not part of any directory response, only a
// dedicated admin/HR path would ever read it. Keeping it out of these
// queries entirely means it can't leak through the directory by accident.

const PUBLIC_PROFILE_COLUMNS = `
  u.id,
  u.email,
  u.status,
  u.availability,
  u.department_id,
  d.name AS department_name,
  p.full_name,
  p.job_title,
  p.phone,
  p.linkedin_url,
  p.timezone,
  TO_CHAR(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
  (SELECT hd.name FROM departments hd WHERE hd.head_user_id = u.id LIMIT 1) AS heads_department_name
`;

// Search by name, job title or department name. Case-insensitive partial
// match. Scoped to the caller's organization.
export async function searchDirectory(organizationId: string, query: string, limit = 25) {
  const like = `%${query}%`;
  const result = await pool.query(
    `SELECT ${PUBLIC_PROFILE_COLUMNS}
     FROM users u
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.organization_id = $1
       AND u.deleted_at IS NULL
       AND (
         p.full_name ILIKE $2
         OR p.job_title ILIKE $2
         OR d.name ILIKE $2
       )
     ORDER BY p.full_name ASC
     LIMIT $3`,
    [organizationId, like, limit]
  );
  return result.rows;
}

// List everyone in the org, optionally filtered to one department.
// Paginated so a 300k-employee org doesn't return everything at once.
export async function listDirectory(
  organizationId: string,
  departmentId: string | null,
  limit = 25,
  offset = 0
) {
  const params: any[] = [organizationId];
  let departmentFilter = '';

  if (departmentId) {
    params.push(departmentId);
    departmentFilter = `AND u.department_id = $${params.length}`;
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await pool.query(
    `SELECT ${PUBLIC_PROFILE_COLUMNS}
     FROM users u
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.organization_id = $1
       AND u.deleted_at IS NULL
       ${departmentFilter}
     ORDER BY p.full_name ASC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params
  );
  return result.rows;
}

// A single person's public profile card.
export async function getProfile(organizationId: string, userId: string) {
  const result = await pool.query(
    `SELECT ${PUBLIC_PROFILE_COLUMNS},
            p.address,
            p.hire_date,
            p.manager_id,
            mp.full_name AS manager_name
     FROM users u
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN employee_profiles mp ON mp.user_id = p.manager_id
     WHERE u.organization_id = $1 AND u.id = $2`,
    [organizationId, userId]
  );
  return result.rows[0] || null;
}

// Let a user update their OWN profile. Only these fields, never role,
// department assignment, employee_number or national_id, those are
// admin-controlled, not self-service. Job title used to be self-service
// too, but Anja flagged that anyone could set their own title to
// whatever they liked - it's now admin/department-admin only, via
// updateJobTitle below.
interface UpdateProfileInput {
  fullName?: string;
  phone?: string;
  address?: string;
  linkedinUrl?: string;
  timezone?: string;
  dateOfBirth?: string; // 'YYYY-MM-DD'
}

export async function updateOwnProfile(userId: string, input: UpdateProfileInput) {
  const result = await pool.query(
    `UPDATE employee_profiles
     SET full_name     = COALESCE($2, full_name),
         phone         = COALESCE($3, phone),
         address       = COALESCE($4, address),
         linkedin_url  = COALESCE($5, linkedin_url),
         timezone      = COALESCE($6, timezone),
         date_of_birth = COALESCE($7::date, date_of_birth)
     WHERE user_id = $1
     RETURNING user_id, full_name, job_title, phone, address, linkedin_url, timezone,
               TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth`,
    [
      userId,
      input.fullName ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.linkedinUrl ?? null,
      input.timezone ?? null,
      input.dateOfBirth ?? null,
    ]
  );
  return result.rows[0];
}

// The department a user belongs to, org-scoped. Used to check whether a
// department_admin is allowed to edit a given person's title - they can
// only edit people in their own department, so this gets called for both
// the caller and the target and the two are compared.
export async function getUserDepartmentId(organizationId: string, userId: string): Promise<{ found: boolean; departmentId: string | null }> {
  const result = await pool.query(
    'SELECT department_id FROM users WHERE id = $1 AND organization_id = $2',
    [userId, organizationId]
  );
  if (result.rows.length === 0) return { found: false, departmentId: null };
  return { found: true, departmentId: result.rows[0].department_id };
}

// Set someone else's job title. Org-scoped so one org can never touch
// another's data; the actual admin-vs-department-admin permission check
// (and the department_admin-can-only-edit-their-own-department rule)
// happens in the controller, using getUserDepartmentId above - this
// function just performs the write once that's already been decided.
export async function updateJobTitle(organizationId: string, targetUserId: string, jobTitle: string) {
  const result = await pool.query(
    `UPDATE employee_profiles
     SET job_title = $1
     WHERE user_id = $2
       AND user_id IN (SELECT id FROM users WHERE organization_id = $3)
     RETURNING user_id, full_name, job_title, phone, address, linkedin_url, timezone,
               TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth`,
    [jobTitle, targetUserId, organizationId]
  );
  return result.rows[0] || null;
}

// People in the org whose birthday is TODAY (matched on month + day, any
// year). Used by the Company Hub "celebrate your people" card. Reads
// date_of_birth from employee_profiles; returns only name + department, no
// birth year, so we're not exposing age.
export async function birthdaysToday(organizationId: string) {
  const result = await pool.query(
    `SELECT u.id, p.full_name, p.job_title, d.name AS department_name
     FROM users u
     JOIN employee_profiles p ON p.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.organization_id = $1
       AND u.deleted_at IS NULL
       AND p.date_of_birth IS NOT NULL
       AND EXTRACT(MONTH FROM p.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(DAY FROM p.date_of_birth) = EXTRACT(DAY FROM CURRENT_DATE)
     ORDER BY p.full_name ASC`,
    [organizationId]
  );
  return result.rows;
}
