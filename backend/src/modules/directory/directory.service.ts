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
  u.department_id,
  d.name AS department_name,
  p.full_name,
  p.job_title,
  p.phone,
  p.linkedin_url,
  p.timezone
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
// admin-controlled, not self-service.
interface UpdateProfileInput {
  fullName?: string;
  jobTitle?: string;
  phone?: string;
  address?: string;
  linkedinUrl?: string;
  timezone?: string;
}

export async function updateOwnProfile(userId: string, input: UpdateProfileInput) {
  const result = await pool.query(
    `UPDATE employee_profiles
     SET full_name    = COALESCE($2, full_name),
         job_title    = COALESCE($3, job_title),
         phone        = COALESCE($4, phone),
         address      = COALESCE($5, address),
         linkedin_url = COALESCE($6, linkedin_url),
         timezone     = COALESCE($7, timezone)
     WHERE user_id = $1
     RETURNING user_id, full_name, job_title, phone, address, linkedin_url, timezone`,
    [
      userId,
      input.fullName ?? null,
      input.jobTitle ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.linkedinUrl ?? null,
      input.timezone ?? null,
    ]
  );
  return result.rows[0];
}
