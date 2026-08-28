import { Request, Response } from 'express';
import {
  searchDirectory,
  listDirectory,
  getProfile,
  updateOwnProfile,
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

export async function search(req: Request, res: Response) {
  try {
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
    const { fullName, jobTitle, phone, address, linkedinUrl, timezone } = req.body;
    const updated = await updateOwnProfile(req.user!.userId, {
      fullName,
      jobTitle,
      phone,
      address,
      linkedinUrl,
      timezone,
    });
    return res.json({ profile: updated });
  } catch (err) {
    console.error('Update own profile error:', err);
    return res.status(500).json({ error: 'Could not update your profile' });
  }
}
