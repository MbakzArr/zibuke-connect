import { Request, Response } from 'express';
import { setAvailability } from './users.service';
import { broadcastToOrg } from '../messaging/realtime';

export async function updateAvailability(req: Request, res: Response) {
  try {
    const { availability } = req.body;
    if (!availability) {
      return res.status(400).json({ error: 'availability is required' });
    }
    await setAvailability(req.user!.userId, availability);
    // Broadcast live so anyone viewing this person's status (People Online,
    // a DM header, their profile card) updates without needing a refresh -
    // same org-wide pattern already used for live reaction counts.
    broadcastToOrg(req.user!.organizationId, 'availability:update', {
      userId: req.user!.userId,
      availability,
    });
    return res.json({ availability });
  } catch (err: any) {
    if (err.message === 'INVALID_AVAILABILITY') {
      return res.status(400).json({ error: 'availability must be available, busy or away' });
    }
    console.error('Update availability error:', err);
    return res.status(500).json({ error: 'Could not update availability' });
  }
}
