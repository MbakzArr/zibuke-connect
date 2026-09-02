import { Request, Response } from 'express';
import { listAllUsers, createEmployee, removeEmployee, restoreEmployee, changeRole, changeDepartment, resetEmployeePassword } from './admin.service';

export async function list(req: Request, res: Response) {
  try {
    const users = await listAllUsers(req.user!.organizationId);
    return res.json({ users });
  } catch (err) {
    console.error('Admin list users error:', err);
    return res.status(500).json({ error: 'Could not load employees' });
  }
}

export async function create(req: Request, res: Response) {
  try {
    const { email, password, fullName, jobTitle, role, departmentId } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'email, password and fullName are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const user = await createEmployee({
      organizationId: req.user!.organizationId,
      email,
      password,
      fullName: String(fullName).trim(),
      jobTitle: jobTitle ? String(jobTitle).trim() : undefined,
      role,
      departmentId: departmentId || null,
    });
    return res.status(201).json({ user });
  } catch (err: any) {
    if (err.message === 'EMAIL_ALREADY_REGISTERED') {
      return res.status(409).json({ error: 'That email is already registered' });
    }
    if (err.message === 'DEPARTMENT_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That department is not part of your organization' });
    }
    console.error('Admin create employee error:', err);
    return res.status(500).json({ error: 'Could not create employee' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    await removeEmployee(req.user!.organizationId, req.params.id, req.user!.userId);
    return res.json({ removed: true });
  } catch (err: any) {
    if (err.message === 'CANNOT_REMOVE_SELF') {
      return res.status(400).json({ error: "You can't remove your own account" });
    }
    if (err.message === 'LAST_ADMIN') {
      return res.status(400).json({ error: 'Cannot remove the last remaining admin - promote someone else to admin first' });
    }
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Admin remove employee error:', err);
    return res.status(500).json({ error: 'Could not remove employee' });
  }
}

export async function restore(req: Request, res: Response) {
  try {
    await restoreEmployee(req.user!.organizationId, req.params.id);
    return res.json({ restored: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Admin restore employee error:', err);
    return res.status(500).json({ error: 'Could not restore employee' });
  }
}

export async function setRole(req: Request, res: Response) {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ error: 'role is required' });
    }
    const updated = await changeRole(req.user!.organizationId, req.params.id, role);
    return res.json({ user: updated });
  } catch (err: any) {
    if (err.message === 'INVALID_ROLE') {
      return res.status(400).json({ error: 'role must be admin, department_admin or employee' });
    }
    if (err.message === 'LAST_ADMIN') {
      return res.status(400).json({ error: 'Cannot demote the last remaining admin - promote someone else to admin first' });
    }
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Admin set role error:', err);
    return res.status(500).json({ error: 'Could not update role' });
  }
}

export async function setDepartment(req: Request, res: Response) {
  try {
    // Explicit null clears it. Missing the key entirely is treated the
    // same as null here (there's no "leave unchanged" case for this
    // endpoint - it always sets exactly what's sent).
    const departmentId = req.body.departmentId || null;
    const updated = await changeDepartment(req.user!.organizationId, req.params.id, departmentId);
    return res.json({ user: updated });
  } catch (err: any) {
    if (err.message === 'DEPARTMENT_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That department is not part of your organization' });
    }
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Admin set department error:', err);
    return res.status(500).json({ error: 'Could not update department' });
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    await resetEmployeePassword(req.user!.organizationId, req.params.id, newPassword);
    return res.json({ reset: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Admin reset password error:', err);
    return res.status(500).json({ error: 'Could not reset password' });
  }
}
