import { Request, Response } from 'express';
import { pool } from '../../db/pool';
import {
  searchDirectory,
  listDirectory,
  getProfile,
  updateOwnProfile,
  updateJobTitle,
  getUserDepartmentId,
  birthdaysToday,
} from './directory.service';

// Clamp pagination so a caller can't request an unbounded page and pull
// the whole org in one query, matters for the 300k-employee target.
function parsePagination(req: Request) {
  let limit = parseInt(String(req.query.limit ?? '25'), 10);
  let offset = parseInt(String(req.query.offset ?? '0'), 10);
  if (isNaN(limit) || limit < 1) limit = 25;
  if (limit > 100) limit = 100;
  if (isNaN(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

async function isCandidate(req: Request): Promise<boolean> {
  const self = await pool.query('SELECT user_type FROM users WHERE id = $1', [req.user!.userId]);
  return self.rows[0]?.user_type === 'candidate';
}

export async function search(req: Request, res: Response) {
  try {
    // Candidates can't browse or search the org directory - real
    // employees' names, roles and contact details aren't something an
    // outsider should be able to discover, even though every other
    // department can see it freely. Viewing a specific profile you
    // already know the id for (e.g. from a shared channel) is a
    // different, narrower thing and isn't restricted here - see profile()
    // below.
    if (await isCandidate(req)) {
      return res.json({ results: [] });
    }
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const { limit } = parsePagination(req);
    const results = await searchDirectory(req.user!.organizationId, q, limit);
    return res.json({ results });
  } catch (err) {
    console.error('Directory search error:', err);
    return res.status(500).json({ error: 'Could not search the directory' });
  }
}

export async function list(req: Request, res: Response) {
  try {
    if (await isCandidate(req)) {
      return res.json({ people: [], limit: 0, offset: 0 });
    }
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : null;
    const { limit, offset } = parsePagination(req);
    const people = await listDirectory(req.user!.organizationId, departmentId, limit, offset);
    return res.json({ people, limit, offset });
  } catch (err) {
    console.error('Directory list error:', err);
    return res.status(500).json({ error: 'Could not load the directory' });
  }
}

export async function profile(req: Request, res: Response) {
  try {
    const person = await getProfile(req.user!.organizationId, req.params.id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }
    return res.json({ profile: person });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Could not load profile' });
  }
}

export async function updateMe(req: Request, res: Response) {
  try {
    // jobTitle is deliberately not accepted here even if a client sends
    // it - see updateTitle below for who's actually allowed to set it.
    const { fullName, phone, address, linkedinUrl, timezone, dateOfBirth } = req.body;
    const updated = await updateOwnProfile(req.user!.userId, {
      fullName,
      phone,
      address,
      linkedinUrl,
      timezone,
      dateOfBirth,
    });
    return res.json({ profile: updated });
  } catch (err) {
    console.error('Update own profile error:', err);
    return res.status(500).json({ error: 'Could not update your profile' });
  }
}

// Set someone else's job title. Admins can edit anyone in the org; a
// department_admin can only edit people in their own department - same
// scoping rule as posting a department announcement. Employees can't
// reach this at all, and can no longer set their own title either (see
// updateMe above) - both were Anja's call after seeing it could be set
// to anything, by anyone, in the demo.
export async function updateTitle(req: Request, res: Response) {
  try {
    if (req.user!.role !== 'admin' && req.user!.role !== 'department_admin') {
      return res.status(403).json({ error: 'Only an admin or department admin can change someone\u2019s job title' });
    }
    const { jobTitle } = req.body;
    if (typeof jobTitle !== 'string' || jobTitle.trim().length === 0) {
      return res.status(400).json({ error: 'jobTitle is required' });
    }

    if (req.user!.role === 'department_admin') {
      const [caller, target] = await Promise.all([
        getUserDepartmentId(req.user!.organizationId, req.user!.userId),
        getUserDepartmentId(req.user!.organizationId, req.params.id),
      ]);
      if (!target.found) {
        return res.status(404).json({ error: 'Person not found' });
      }
      if (!caller.departmentId || caller.departmentId !== target.departmentId) {
        return res.status(403).json({ error: 'You can only edit job titles for people in your own department' });
      }
    }

    const updated = await updateJobTitle(req.user!.organizationId, req.params.id, jobTitle.trim());
    if (!updated) {
      return res.status(404).json({ error: 'Person not found' });
    }
    return res.json({ profile: updated });
  } catch (err) {
    console.error('Update job title error:', err);
    return res.status(500).json({ error: 'Could not update job title' });
  }
}

export async function birthdays(req: Request, res: Response) {
  try {
    const people = await birthdaysToday(req.user!.organizationId);
    return res.json({ birthdays: people });
  } catch (err) {
    console.error('Birthdays error:', err);
    return res.status(500).json({ error: 'Could not load birthdays' });
  }
}
