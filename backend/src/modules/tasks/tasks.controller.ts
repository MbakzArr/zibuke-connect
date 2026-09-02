import { Request, Response } from 'express';
import {
  createTask,
  listMyTasks,
  listAssignedByMe,
  listTaskDatesForMonth,
  listDueOrOverdue,
  setTaskStatus,
  updateTask,
  deleteTask,
} from './tasks.service';

export async function create(req: Request, res: Response) {
  try {
    const { title, description, assignedTo, dueDate } = req.body;
    if (!title || String(title).trim().length === 0) {
      return res.status(400).json({ error: 'Task title is required' });
    }
    if (!assignedTo) {
      return res.status(400).json({ error: 'assignedTo is required' });
    }
    const task = await createTask({
      organizationId: req.user!.organizationId,
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      assignedTo,
      assignedBy: req.user!.userId,
      dueDate: dueDate || undefined,
    });
    return res.status(201).json({ task });
  } catch (err: any) {
    if (err.message === 'ASSIGNEE_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That person is not part of your organization' });
    }
    console.error('Create task error:', err);
    return res.status(500).json({ error: 'Could not create task' });
  }
}

export async function mine(req: Request, res: Response) {
  try {
    const tasks = await listMyTasks(req.user!.organizationId, req.user!.userId);
    return res.json({ tasks });
  } catch (err) {
    console.error('List my tasks error:', err);
    return res.status(500).json({ error: 'Could not load tasks' });
  }
}

export async function assignedByMe(req: Request, res: Response) {
  try {
    const tasks = await listAssignedByMe(req.user!.organizationId, req.user!.userId);
    return res.json({ tasks });
  } catch (err) {
    console.error('List assigned-by-me tasks error:', err);
    return res.status(500).json({ error: 'Could not load tasks' });
  }
}

export async function monthDates(req: Request, res: Response) {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }
    const dates = await listTaskDatesForMonth(req.user!.organizationId, req.user!.userId, year, month);
    return res.json({ dates });
  } catch (err) {
    console.error('Task month dates error:', err);
    return res.status(500).json({ error: 'Could not load task dates' });
  }
}

export async function dueSoon(req: Request, res: Response) {
  try {
    const tasks = await listDueOrOverdue(req.user!.organizationId, req.user!.userId);
    return res.json({ tasks });
  } catch (err) {
    console.error('Due-soon tasks error:', err);
    return res.status(500).json({ error: 'Could not load tasks' });
  }
}

export async function setStatus(req: Request, res: Response) {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    const isAdmin = req.user!.role === 'admin';
    const task = await setTaskStatus(req.params.id, req.user!.userId, isAdmin, status);
    return res.json({ task });
  } catch (err: any) {
    if (err.message === 'INVALID_STATUS') {
      return res.status(400).json({ error: 'status must be open or done' });
    }
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (err.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Only the assignee or whoever assigned this task can update it' });
    }
    console.error('Set task status error:', err);
    return res.status(500).json({ error: 'Could not update task' });
  }
}

export async function update(req: Request, res: Response) {
  try {
    const { title, description, dueDate, assignedTo } = req.body;
    const isAdmin = req.user!.role === 'admin';
    const task = await updateTask(req.params.id, req.user!.userId, isAdmin, { title, description, dueDate, assignedTo });
    return res.json({ task });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (err.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Only whoever assigned this task can edit it' });
    }
    console.error('Update task error:', err);
    return res.status(500).json({ error: 'Could not update task' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const isAdmin = req.user!.role === 'admin';
    await deleteTask(req.params.id, req.user!.userId, isAdmin);
    return res.json({ deleted: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (err.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Only whoever assigned this task can delete it' });
    }
    console.error('Delete task error:', err);
    return res.status(500).json({ error: 'Could not delete task' });
  }
}
