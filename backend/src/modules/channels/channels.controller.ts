import { Request, Response } from 'express';
import { pool } from '../../db/pool';
import {
  listChannelsForUser,
  getChannel,
  isMember,
  createChannel,
  requestToJoin,
  listPendingRequests,
  resolveJoinRequest,
  leaveChannel,
  listMembers,
  getOrCreateDm,
  listDmsForUser,
  listBrowsableChannels,
  markChannelRead,
  clearChannelForUser,
  deleteChannelForEveryone,
  canManageChannel,
  addMemberDirectly,
  getDmOtherReadAt,
  searchChannelsAndDms,
} from './channels.service';
import { emitToChannel } from '../messaging/realtime';

export async function list(req: Request, res: Response) {
  try {
    const channels = await listChannelsForUser(req.user!.organizationId, req.user!.userId);
    return res.json({ channels });
  } catch (err) {
    console.error('List channels error:', err);
    return res.status(500).json({ error: 'Could not load channels' });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const channel = await getChannel(req.user!.organizationId, req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // A private channel or DM should only be visible to its members.
    if (channel.is_private || channel.is_dm) {
      const member = await isMember(channel.id, req.user!.userId);
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this channel' });
      }
    }
    return res.json({ channel });
  } catch (err) {
    console.error('Get channel error:', err);
    return res.status(500).json({ error: 'Could not load channel' });
  }
}

export async function create(req: Request, res: Response) {
  try {
    const { name, departmentId, isPrivate, visibleToCandidates } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    // Candidates get a deliberately curated, admin-controlled experience
    // (only channels explicitly opened up to them) - letting them create
    // their own channels would work against that entirely.
    const requester = await pool.query('SELECT user_type FROM users WHERE id = $1', [req.user!.userId]);
    if (requester.rows[0]?.user_type === 'candidate') {
      return res.status(403).json({ error: 'Candidates cannot create channels' });
    }
    // Same rule as announcements: marking a channel visible to candidates
    // is a full-admin call, not something a department_admin decides,
    // since candidates aren't tied to any one department.
    if (visibleToCandidates && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can make a channel visible to candidates' });
    }

    const channel = await createChannel({
      organizationId: req.user!.organizationId,
      name: name.trim(),
      createdBy: req.user!.userId,
      departmentId,
      isPrivate,
      visibleToCandidates: Boolean(visibleToCandidates),
    });
    return res.status(201).json({ channel });
  } catch (err: any) {
    if (err.message === 'DEPARTMENT_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That department is not part of your organization' });
    }
    console.error('Create channel error:', err);
    return res.status(500).json({ error: 'Could not create channel' });
  }
}

export async function join(req: Request, res: Response) {
  try {
    const result = await requestToJoin(req.user!.organizationId, req.params.id, req.user!.userId);
    return res.json(result);
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (err.message === 'CANNOT_SELF_JOIN') {
      return res.status(403).json({ error: 'This channel is invite-only' });
    }
    console.error('Join channel error:', err);
    return res.status(500).json({ error: 'Could not request to join' });
  }
}

// Who's allowed to see/act on a channel's pending requests: its creator,
// or any admin (covers both the "creator's account was removed" fallback
// and just gives admins visibility generally - matches how admins can
// already see everything else in the org).
async function canManageRequests(req: Request, channel: { id: string; created_by: string }): Promise<boolean> {
  return canManageChannel(channel.id, channel.created_by, req.user!.userId, req.user!.role === 'admin');
}

export async function listJoinRequests(req: Request, res: Response) {
  try {
    const channel = await getChannel(req.user!.organizationId, req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (!(await canManageRequests(req, channel))) {
      return res.status(403).json({ error: 'Only this channel\u2019s creator or an admin can view its join requests' });
    }
    const requests = await listPendingRequests(req.params.id);
    return res.json({ requests });
  } catch (err) {
    console.error('List join requests error:', err);
    return res.status(500).json({ error: 'Could not load join requests' });
  }
}

export async function respondToJoinRequest(req: Request, res: Response) {
  try {
    const { decision } = req.body;
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    // Look the request up via its channel first, so we can check
    // permission BEFORE touching it - resolveJoinRequest itself trusts
    // the caller, this is where that trust is actually established.
    const channel = await getChannel(req.user!.organizationId, req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (!(await canManageRequests(req, channel))) {
      return res.status(403).json({ error: 'Only this channel\u2019s creator or an admin can respond to its join requests' });
    }
    const result = await resolveJoinRequest(req.params.requestId, req.user!.userId, decision);
    return res.json(result);
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Join request not found' });
    }
    if (err.message === 'ALREADY_RESOLVED') {
      return res.status(409).json({ error: 'That request has already been resolved' });
    }
    console.error('Respond to join request error:', err);
    return res.status(500).json({ error: 'Could not update that request' });
  }
}

export async function leave(req: Request, res: Response) {
  try {
    await leaveChannel(req.params.id, req.user!.userId);
    return res.json({ left: true });
  } catch (err) {
    console.error('Leave channel error:', err);
    return res.status(500).json({ error: 'Could not leave channel' });
  }
}

// Add someone directly, no self-request needed - the creator (while
// still a member) or an admin only. This is the only way anyone gets
// into a private channel after it's created (there's no self-request
// path for those at all), and it's how a candidate actually ends up in
// a channel in practice - they can only ever discover and request to
// join something already marked visible to them, so someone with
// authority over the channel adding them directly is the real front
// door, not a workaround.
export async function addMember(req: Request, res: Response) {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const result = await addMemberDirectly(
      req.user!.organizationId,
      req.params.id,
      userId,
      req.user!.userId,
      req.user!.role === 'admin'
    );
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') return res.status(404).json({ error: 'Channel not found' });
      if (result.reason === 'USER_NOT_FOUND') return res.status(404).json({ error: 'That person was not found' });
      if (result.reason === 'ALREADY_MEMBER') return res.status(409).json({ error: 'Already a member of this channel' });
      return res.status(403).json({ error: 'Only this channel\u2019s creator or an admin can add members' });
    }
    return res.json({ added: true });
  } catch (err) {
    console.error('Add member error:', err);
    return res.status(500).json({ error: 'Could not add that person' });
  }
}

// Personal only - clears this channel from just the caller's own sidebar
// and hides its history for them, without removing their membership.
// Anyone who's a member can do this to their own view; no special
// permission needed since it never affects anyone else.
export async function clearForMe(req: Request, res: Response) {
  try {
    const member = await isMember(req.params.id, req.user!.userId);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this channel' });
    }
    await clearChannelForUser(req.params.id, req.user!.userId);
    return res.json({ cleared: true });
  } catch (err) {
    console.error('Clear channel error:', err);
    return res.status(500).json({ error: 'Could not clear channel' });
  }
}

// Real deletion - affects everyone. Only the channel's creator or an
// admin can do this, and it's checked server-side (deleteChannelForEveryone
// re-verifies ownership itself rather than trusting the client).
export async function remove(req: Request, res: Response) {
  try {
    const result = await deleteChannelForEveryone(req.params.id, req.user!.userId, req.user!.role === 'admin');
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Channel not found' });
      }
      return res.status(403).json({ error: 'Only the channel creator or an admin can delete this channel' });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error('Delete channel error:', err);
    return res.status(500).json({ error: 'Could not delete channel' });
  }
}

export async function members(req: Request, res: Response) {
  try {
    const channel = await getChannel(req.user!.organizationId, req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // Only members can see the member list of a private channel or DM.
    if (channel.is_private || channel.is_dm) {
      const member = await isMember(channel.id, req.user!.userId);
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this channel' });
      }
    }
    const list = await listMembers(channel.id);
    return res.json({ members: list });
  } catch (err) {
    console.error('List members error:', err);
    return res.status(500).json({ error: 'Could not load members' });
  }
}

export async function openDm(req: Request, res: Response) {
  try {
    const channel = await getOrCreateDm(
      req.user!.organizationId,
      req.user!.userId,
      req.params.userId
    );
    return res.json({ channel });
  } catch (err: any) {
    if (err.message === 'CANNOT_DM_SELF') {
      return res.status(400).json({ error: 'You cannot open a direct message with yourself' });
    }
    if (err.message === 'USER_NOT_IN_ORG') {
      return res.status(404).json({ error: 'That user is not part of your organization' });
    }
    console.error('Open DM error:', err);
    return res.status(500).json({ error: 'Could not open direct message' });
  }
}

export async function listDms(req: Request, res: Response) {
  try {
    const dms = await listDmsForUser(req.user!.organizationId, req.user!.userId);
    return res.json({ dms });
  } catch (err) {
    console.error('List DMs error:', err);
    return res.status(500).json({ error: 'Could not load direct messages' });
  }
}

export async function browse(req: Request, res: Response) {
  try {
    const channels = await listBrowsableChannels(req.user!.organizationId, req.user!.userId);
    return res.json({ channels });
  } catch (err) {
    console.error('Browse channels error:', err);
    return res.status(500).json({ error: 'Could not load channels' });
  }
}

export async function searchPlaces(req: Request, res: Response) {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ channels: [], dms: [] });
    const results = await searchChannelsAndDms(req.user!.organizationId, req.user!.userId, q);
    return res.json(results);
  } catch (err) {
    console.error('Search places error:', err);
    return res.status(500).json({ error: 'Could not search channels' });
  }
}

export async function markRead(req: Request, res: Response) {
  try {
    const { lastReadAt, previousReadAt } = await markChannelRead(req.user!.userId, req.params.id);
    // Push it live so anyone else with this channel open (the other side of
    // a DM, checking whether their message was seen) updates without a
    // refresh - same pattern as message:new/message:updated.
    emitToChannel(req.params.id, 'channel:read', {
      channelId: req.params.id,
      userId: req.user!.userId,
      lastReadAt,
    });
    return res.json({ read: true, lastReadAt, previousReadAt });
  } catch (err) {
    console.error('Mark channel read error:', err);
    return res.status(500).json({ error: 'Could not update read status' });
  }
}

// For a DM: when did the other person last read it. Powers the "Seen" tick.
export async function readStatus(req: Request, res: Response) {
  try {
    const otherLastReadAt = await getDmOtherReadAt(req.params.id, req.user!.userId);
    return res.json({ otherLastReadAt });
  } catch (err) {
    console.error('Read status error:', err);
    return res.status(500).json({ error: 'Could not load read status' });
  }
}
