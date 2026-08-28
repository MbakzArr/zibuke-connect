import { Request, Response } from 'express';
import { listAnnouncements, createAnnouncement } from './announcements.service';

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

    const { title, content, departmentId } = req.body;
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement title is required' });
    }
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement content is required' });
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
    return res.status(500).json({ error: 'Could not create announcement' });
  }
}
