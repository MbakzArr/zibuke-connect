import { Request, Response, NextFunction } from 'express';

// Must run AFTER requireAuth (needs req.user already set). Only the full
// 'admin' role passes - department_admin is a narrower role for things
// like posting announcements, not employee management.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
