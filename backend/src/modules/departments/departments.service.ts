import { pool } from '../../db/pool';

// All queries are scoped by organizationId, taken from the caller's JWT,
// never from the request body. That's what keeps one org from reading or
// writing another org's departments once this becomes multi-tenant.

interface CreateDepartmentInput {
  organizationId: string;
  name: string;
  headUserId?: string | null;
}

export async function listDepartments(organizationId: string) {
  const result = await pool.query(
    `SELECT d.id, d.name, d.head_user_id, d.created_at,
            p.full_name AS head_name
     FROM departments d
     LEFT JOIN employee_profiles p ON p.user_id = d.head_user_id
     WHERE d.organization_id = $1
     ORDER BY d.name ASC`,
    [organizationId]
  );
  return result.rows;
}

export async function getDepartment(organizationId: string, departmentId: string) {
  const result = await pool.query(
    `SELECT d.id, d.name, d.head_user_id, d.created_at,
            p.full_name AS head_name
     FROM departments d
     LEFT JOIN employee_profiles p ON p.user_id = d.head_user_id
     WHERE d.organization_id = $1 AND d.id = $2`,
    [organizationId, departmentId]
  );
  return result.rows[0] || null;
}

export async function createDepartment(input: CreateDepartmentInput) {
  const { organizationId, name, headUserId } = input;

  // If a head is named, make sure they actually belong to this org.
  if (headUserId) {
    const head = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
      [headUserId, organizationId]
    );
    if (head.rows.length === 0) {
      throw new Error('HEAD_NOT_IN_ORG');
    }
  }

  const result = await pool.query(
    `INSERT INTO departments (organization_id, name, head_user_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, head_user_id, created_at`,
    [organizationId, name, headUserId || null]
  );
  return result.rows[0];
}

export async function updateDepartment(
  organizationId: string,
  departmentId: string,
  name?: string,
  headUserId?: string | null
) {
  // Confirm the department is in the caller's org before touching it.
  const existing = await getDepartment(organizationId, departmentId);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }

  if (headUserId) {
    const head = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
      [headUserId, organizationId]
    );
    if (head.rows.length === 0) {
      throw new Error('HEAD_NOT_IN_ORG');
    }
  }

  const result = await pool.query(
    `UPDATE departments
     SET name = COALESCE($3, name),
         head_user_id = COALESCE($4, head_user_id)
     WHERE organization_id = $1 AND id = $2
     RETURNING id, name, head_user_id, created_at`,
    [organizationId, departmentId, name ?? null, headUserId ?? null]
  );
  return result.rows[0];
}

export async function deleteDepartment(organizationId: string, departmentId: string) {
  const result = await pool.query(
    `DELETE FROM departments
     WHERE organization_id = $1 AND id = $2
     RETURNING id`,
    [organizationId, departmentId]
  );
  return result.rows.length > 0;
}
