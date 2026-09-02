import { Request, Response } from 'express';
import { pool } from '../../db/pool';
import { listAnnouncements, createAnnouncement, getAnnouncement } from './announcements.service';

export async function list(req: Request, res: Response) {
  try {
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : null;
    const announcements = await listAnnouncements(req.user!.organizationId, departmentId);
    return res.json({ announcements });
  } catch (err) {
    console.error('List announcements error:', err);
    return res.status(500).json({ error: 'Could not load announcements' });
  }
}

export async function create(req: Request, res: Response) {
  try {
    // Only admins and department admins can post announcements.
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'You do not have permission to post announcements' });
    }

    const { title, content } = req.body;
    let { departmentId } = req.body;
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement title is required' });
    }
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement content is required' });
    }

    // A department_admin can only ever post to THEIR OWN department, never
    // org-wide and never someone else's - a full admin is the only role
    // that can do either of those. department_id isn't in the JWT (adding
    // it there would mean re-issuing every token whenever someone's
    // department changes), so it's looked up fresh here instead.
    if (req.user!.role === 'department_admin') {
      const self = await pool.query('SELECT department_id FROM users WHERE id = $1', [req.user!.userId]);
      const ownDepartmentId = self.rows[0]?.department_id || null;
      if (!ownDepartmentId) {
        return res.status(400).json({ error: "You're not assigned to a department yet, so there's nothing to post an announcement to. Ask an admin to assign you one." });
      }
      if (departmentId && departmentId !== ownDepartmentId) {
        return res.status(403).json({ error: 'You can only post announcements to your own department' });
      }
      departmentId = ownDepartmentId;
    }

    const announcement = await createAnnouncement({
      organizationId: req.user!.organizationId,
      departmentId,
      title: title.trim(),
      content: content.trim(),
      createdBy: req.user!.userId,
    });
    return res.status(201).json({ announcement });
  } catch (err: any) {
    if (err.message === 'DEPARTMENT_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That department is not part of your organization' });
    }
    console.error('Create announcement error:', err);
    return res.status(500).json({ error: 'Could not post announcement' });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const ann = await getAnnouncement(req.user!.organizationId, req.params.id);
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });
    return res.json({ announcement: ann });
  } catch (err) {
    console.error('Get announcement error:', err);
    return res.status(500).json({ error: 'Could not load announcement' });
  }
}
