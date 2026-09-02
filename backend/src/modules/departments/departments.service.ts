import { pool } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';

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
  const department = result.rows[0];

  // Being named head doesn't do anything visible on its own otherwise -
  // no badge appears anywhere, no one's told. This is the one place both
  // of those actually happen: the notification here, and the profile/
  // directory badge comes from directory.service's PUBLIC_PROFILE_COLUMNS
  // picking up head_user_id via a subquery.
  if (headUserId) {
    createNotification({ userId: headUserId, type: 'department_head', sourceId: department.id })
      .catch((err) => console.error('Department head notification failed:', err));
  }

  return department;
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

  // Built dynamically rather than a blanket COALESCE($n, existing) for
  // every field: COALESCE can't tell "clear this to null" apart from
  // "didn't send this field at all" - both look like a null parameter to
  // it. That silently broke "remove the head" (picking "No head" in the
  // UI sends headUserId: null, which COALESCE would treat as "leave it
  // alone" and just keep the old head). Only touch a column when the
  // caller actually passed something for it - undefined here means
  // "unchanged", null means "explicitly clear it".
  const setParts: string[] = [];
  const params: any[] = [organizationId, departmentId];
  if (name !== undefined) {
    params.push(name);
    setParts.push(`name = $${params.length}`);
  }
  if (headUserId !== undefined) {
    params.push(headUserId); // a real id, or null to clear it
    setParts.push(`head_user_id = $${params.length}`);
  }

  const department = setParts.length === 0
    ? existing
    : (await pool.query(
        `UPDATE departments SET ${setParts.join(', ')}
         WHERE organization_id = $1 AND id = $2
         RETURNING id, name, head_user_id, created_at`,
        params
      )).rows[0];

  // Only notify when the head is actually CHANGING to someone new - not
  // on every unrelated edit (renaming the department shouldn't re-notify
  // the existing head as if they were just appointed).
  if (headUserId && headUserId !== existing.head_user_id) {
    createNotification({ userId: headUserId, type: 'department_head', sourceId: department.id })
      .catch((err) => console.error('Department head notification failed:', err));
  }

  return department;
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
