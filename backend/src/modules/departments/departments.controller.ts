import { Request, Response } from 'express';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from './departments.service';

// req.user is set by requireAuth and always carries organizationId,
// so controllers read the org from the token, not from the client.

export async function list(req: Request, res: Response) {
  try {
    const departments = await listDepartments(req.user!.organizationId);
    return res.json({ departments });
  } catch (err) {
    console.error('List departments error:', err);
    return res.status(500).json({ error: 'Could not load departments' });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const department = await getDepartment(req.user!.organizationId, req.params.id);
    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    return res.json({ department });
  } catch (err) {
    console.error('Get department error:', err);
    return res.status(500).json({ error: 'Could not load department' });
  }
}

export async function create(req: Request, res: Response) {
  try {
    const { name, headUserId } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    // Only admins and department admins can create departments.
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'You do not have permission to create departments' });
    }

    const department = await createDepartment({
      organizationId: req.user!.organizationId,
      name: name.trim(),
      headUserId,
    });
    return res.status(201).json({ department });
  } catch (err: any) {
    if (err.message === 'HEAD_NOT_IN_ORG') {
      return res.status(400).json({ error: 'The chosen head is not part of your organization' });
    }
    console.error('Create department error:', err);
    return res.status(500).json({ error: 'Could not create department' });
  }
}

export async function update(req: Request, res: Response) {
  try {
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'You do not have permission to edit departments' });
    }

    const { name, headUserId } = req.body;
    const department = await updateDepartment(
      req.user!.organizationId,
      req.params.id,
      name,
      headUserId
    );
    return res.json({ department });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (err.message === 'HEAD_NOT_IN_ORG') {
      return res.status(400).json({ error: 'The chosen head is not part of your organization' });
    }
    console.error('Update department error:', err);
    return res.status(500).json({ error: 'Could not update department' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'You do not have permission to delete departments' });
    }

    const deleted = await deleteDepartment(req.user!.organizationId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Department not found' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('Delete department error:', err);
    return res.status(500).json({ error: 'Could not delete department' });
  }
}
