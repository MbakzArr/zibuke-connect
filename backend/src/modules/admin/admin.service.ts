import { pool } from '../../db/pool';
import { hashPassword } from '../auth/password';

const ROLES = ['admin', 'department_admin', 'employee'];

// Everyone in the org, including their role and whether they're removed -
// an admin-only view, unlike the public directory which never shows role
// or a removed person at all.
export async function listAllUsers(organizationId: string) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.status, u.deleted_at, u.department_id,
            p.full_name, p.job_title, d.name AS department_name
     FROM users u
     LEFT JOIN employee_profiles p ON p.user_id = u.id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.organization_id = $1
     ORDER BY (u.deleted_at IS NOT NULL), p.full_name ASC`,
    [organizationId]
  );
  return result.rows;
}

interface CreateEmployeeInput {
  organizationId: string;
  email: string;
  password: string;
  fullName: string;
  jobTitle?: string;
  role?: string;
  departmentId?: string | null;
}

// Admin-created account: same shape as self-registration, but an admin can
// also set the role, job title and department up front instead of the new
// person having to fill those in later (department in particular has no
// self-service path at all - only an admin assigns it).
export async function createEmployee(input: CreateEmployeeInput) {
  const { organizationId, password, fullName, jobTitle, departmentId } = input;
  const email = input.email.trim().toLowerCase();
  const role = input.role && ROLES.includes(input.role) ? input.role : 'employee';

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('EMAIL_ALREADY_REGISTERED');
  }

  if (departmentId) {
    const dept = await pool.query(
      'SELECT id FROM departments WHERE id = $1 AND organization_id = $2',
      [departmentId, organizationId]
    );
    if (dept.rows.length === 0) {
      throw new Error('DEPARTMENT_NOT_IN_ORG');
    }
  }

  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, organization_id, email, role`,
      [organizationId, email, passwordHash, role, departmentId || null]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO employee_profiles (user_id, full_name, job_title)
       VALUES ($1, $2, $3)`,
      [user.id, fullName, jobTitle || null]
    );

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// How many active (not removed) admins the org currently has - used to
// stop the last one from being removed or demoted, which would lock
// everyone out of the admin panel with no way back in short of a direct
// database edit.
async function countActiveAdmins(organizationId: string) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL`,
    [organizationId]
  );
  return result.rows[0].count as number;
}

// Soft delete: keep the row (their message history still needs a real
// user to join against), stamp deleted_at. They can no longer log in or
// appear in the directory. Reversible by clearing deleted_at, on purpose -
// this isn't a destructive action.
export async function removeEmployee(organizationId: string, userId: string, callerId: string) {
  if (userId === callerId) {
    throw new Error('CANNOT_REMOVE_SELF');
  }
  const target = await pool.query(
    `SELECT role FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [userId, organizationId]
  );
  if (target.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  if (target.rows[0].role === 'admin' && (await countActiveAdmins(organizationId)) <= 1) {
    throw new Error('LAST_ADMIN');
  }

  const result = await pool.query(
    `UPDATE users SET deleted_at = now()
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [userId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  return true;
}

export async function restoreEmployee(organizationId: string, userId: string) {
  const result = await pool.query(
    `UPDATE users SET deleted_at = NULL
     WHERE id = $1 AND organization_id = $2
     RETURNING id`,
    [userId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  return true;
}

export async function changeRole(organizationId: string, userId: string, role: string) {
  if (!ROLES.includes(role)) {
    throw new Error('INVALID_ROLE');
  }
  const target = await pool.query(
    `SELECT role FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [userId, organizationId]
  );
  if (target.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  if (target.rows[0].role === 'admin' && role !== 'admin' && (await countActiveAdmins(organizationId)) <= 1) {
    throw new Error('LAST_ADMIN');
  }

  const result = await pool.query(
    `UPDATE users SET role = $1
     WHERE id = $2 AND organization_id = $3 AND deleted_at IS NULL
     RETURNING id, role`,
    [role, userId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  return result.rows[0];
}

// Assign (or clear, with departmentId = null) which department someone
// belongs to. This is what department-scoped announcements actually
// filter their audience on - without this, "post to Engineering only"
// would reach nobody, since nobody would ever be recorded as IN
// Engineering.
export async function changeDepartment(organizationId: string, userId: string, departmentId: string | null) {
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
    `UPDATE users SET department_id = $1
     WHERE id = $2 AND organization_id = $3 AND deleted_at IS NULL
     RETURNING id, department_id`,
    [departmentId, userId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  return result.rows[0];
}

// Force-set someone's password without knowing their old one - the admin
// equivalent of a "forgot password" flow, since there isn't a self-service
// one (no email sending in this app). Covers the dead end where someone
// (including the org's only admin) genuinely forgets theirs: without this,
// the only recovery path is a direct SQL UPDATE on the live database.
// Named differently from the controller's resetPassword (same operation,
// different layer) so the import doesn't collide with it.
export async function resetEmployeePassword(organizationId: string, userId: string, newPassword: string) {
  const newHash = await hashPassword(newPassword);
  const result = await pool.query(
    `UPDATE users SET password_hash = $1
     WHERE id = $2 AND organization_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [newHash, userId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  return true;
}
