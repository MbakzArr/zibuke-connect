import { Request, Response } from 'express';
import {
  listChannelsForUser,
  getChannel,
  isMember,
  createChannel,
  joinChannel,
  leaveChannel,
  listMembers,
  getOrCreateDm,
} from './channels.service';

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
    const { name, departmentId, isPrivate } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    const channel = await createChannel({
      organizationId: req.user!.organizationId,
      name: name.trim(),
      createdBy: req.user!.userId,
      departmentId,
      isPrivate,
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
    await joinChannel(req.user!.organizationId, req.params.id, req.user!.userId);
    return res.json({ joined: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (err.message === 'CANNOT_SELF_JOIN') {
      return res.status(403).json({ error: 'This channel is invite-only' });
    }
    console.error('Join channel error:', err);
    return res.status(500).json({ error: 'Could not join channel' });
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
