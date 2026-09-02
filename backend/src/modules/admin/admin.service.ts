import { pool } from '../../db/pool';
import { hashPassword } from '../auth/password';

const ROLES = ['admin', 'department_admin', 'employee'];

// Everyone in the org, including their role and whether they're removed -
// an admin-only view, unlike the public directory which never shows role
// or a removed person at all.
export async function listAllUsers(organizationId: string) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.status, u.deleted_at,
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
}

// Admin-created account: same shape as self-registration, but an admin can
// also set the role and job title up front instead of the new person
// having to fill those in later.
export async function createEmployee(input: CreateEmployeeInput) {
  const { organizationId, password, fullName, jobTitle } = input;
  const email = input.email.trim().toLowerCase();
  const role = input.role && ROLES.includes(input.role) ? input.role : 'employee';

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('EMAIL_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, email, role`,
      [organizationId, email, passwordHash, role]
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

// Soft delete: keep the row (their message history still needs a real
// user to join against), stamp deleted_at. They can no longer log in or
// appear in the directory. Reversible by clearing deleted_at, on purpose -
// this isn't a destructive action.
export async function removeEmployee(organizationId: string, userId: string, callerId: string) {
  if (userId === callerId) {
    throw new Error('CANNOT_REMOVE_SELF');
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
