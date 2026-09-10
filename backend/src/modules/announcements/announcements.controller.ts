import { Request, Response } from 'express';
import { pool } from '../../db/pool';
import { listAnnouncements, createAnnouncement, getAnnouncement } from './announcements.service';
import { emitToUser } from '../messaging/realtime';
import { processAnnouncementMentions } from '../messaging/mentions.service';
import { runInBackground } from '../../util/background';

// What a viewer is allowed to see: undefined for a full admin (no filter -
// they see every announcement in the org), otherwise their own
// department_id (which may itself be null, meaning "not in a department,
// so only org-wide announcements"). This is deliberately never taken from
// the request - it's always looked up fresh from who's actually asking,
// so there's no query param or body field a client could use to see
// another department's announcements.
async function getViewerScope(req: Request): Promise<string | null | undefined> {
  if (req.user!.role === 'admin') return undefined;
  const self = await pool.query('SELECT department_id FROM users WHERE id = $1', [req.user!.userId]);
  return self.rows[0]?.department_id ?? null;
}

async function isViewerCandidate(req: Request): Promise<boolean> {
  const self = await pool.query('SELECT user_type FROM users WHERE id = $1', [req.user!.userId]);
  return self.rows[0]?.user_type === 'candidate';
}

export async function list(req: Request, res: Response) {
  try {
    const [scope, isCandidate] = await Promise.all([getViewerScope(req), isViewerCandidate(req)]);
    const announcements = await listAnnouncements(req.user!.organizationId, scope, isCandidate);
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

    const { title, content, visibleToCandidates } = req.body;
    let { departmentId } = req.body;
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement title is required' });
    }
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Announcement content is required' });
    }
    // Marking something visible to candidates is a full-admin call, same
    // as posting org-wide - candidates aren't tied to any one department,
    // so a department_admin deciding this would be deciding something
    // outside their own department's scope.
    if (visibleToCandidates && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can make an announcement visible to candidates' });
    }

    // A department_admin can only ever post to THEIR OWN department, never
    // org-wide and never someone else's - a full admin is the only role
    // that can do either of those.
    if (req.user!.role === 'department_admin') {
      const ownDepartmentId = await getViewerScope(req);
      if (!ownDepartmentId) {
        return res.status(400).json({ error: "You're not assigned to a department yet, so there's nothing to post an announcement to. Ask an admin to assign you one." });
      }
      if (departmentId && departmentId !== ownDepartmentId) {
        return res.status(403).json({ error: 'You can only post announcements to your own department' });
      }
      departmentId = ownDepartmentId;
    }

    const { announcement, audienceUserIds } = await createAnnouncement({
      organizationId: req.user!.organizationId,
      departmentId,
      title: title.trim(),
      content: content.trim(),
      createdBy: req.user!.userId,
      visibleToCandidates: Boolean(visibleToCandidates),
    });

    // Push live only to the people who are actually allowed to see this -
    // this used to broadcast to the whole org regardless of department
    // scope, which meant a department-only announcement appeared live for
    // everyone, even outside that department, even though the REST
    // endpoints correctly filtered it on a refresh. Now the live push uses
    // the exact same audience, computed the same way, as the notifications.
    for (const userId of audienceUserIds) {
      emitToUser(userId, 'announcement:new', announcement);
    }

    // @mentions in an announcement never notified anyone before either -
    // genuinely new, not a fix. Wrapped in runInBackground since this does
    // its own database writes (creating notifications) that shouldn't
    // race the response the way a live broadcast alone safely can.
    runInBackground(
      processAnnouncementMentions(
        announcement.id,
        req.user!.organizationId,
        departmentId || null,
        req.user!.userId,
        content.trim()
      )
    );

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
    const [scope, isCandidate] = await Promise.all([getViewerScope(req), isViewerCandidate(req)]);
    const ann = await getAnnouncement(req.user!.organizationId, req.params.id, scope, isCandidate);
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });
    return res.json({ announcement: ann });
  } catch (err) {
    console.error('Get announcement error:', err);
    return res.status(500).json({ error: 'Could not load announcement' });
  }
}
