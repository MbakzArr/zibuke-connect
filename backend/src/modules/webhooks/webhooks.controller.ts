import { Request, Response } from 'express';
import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  postViaWebhook,
} from './webhooks.service';

// --- Management endpoints (require a logged-in admin) ---

export async function create(req: Request, res: Response) {
  try {
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'Only admins can create webhooks' });
    }
    const { channelId, label } = req.body;
    if (!channelId || !label) {
      return res.status(400).json({ error: 'channelId and label are required' });
    }

    const { webhook, token } = await createWebhook({
      organizationId: req.user!.organizationId,
      channelId,
      label,
      createdBy: req.user!.userId,
    });

    // The raw token is returned ONCE here and never again.
    return res.status(201).json({
      webhook,
      token,
      note: 'Store this token now. It will not be shown again.',
    });
  } catch (err: any) {
    if (err.message === 'CHANNEL_NOT_IN_ORG') {
      return res.status(400).json({ error: 'That channel is not part of your organization' });
    }
    console.error('Create webhook error:', err);
    return res.status(500).json({ error: 'Could not create webhook' });
  }
}

export async function list(req: Request, res: Response) {
  try {
    const webhooks = await listWebhooks(req.user!.organizationId);
    return res.json({ webhooks });
  } catch (err) {
    console.error('List webhooks error:', err);
    return res.status(500).json({ error: 'Could not load webhooks' });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    if (req.user!.role === 'employee') {
      return res.status(403).json({ error: 'Only admins can delete webhooks' });
    }
    const ok = await deleteWebhook(req.user!.organizationId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Webhook not found' });
    return res.status(204).send();
  } catch (err) {
    console.error('Delete webhook error:', err);
    return res.status(500).json({ error: 'Could not delete webhook' });
  }
}

// --- Inbound endpoint (authenticated by the webhook token, NOT a JWT) ---

export async function inbound(req: Request, res: Response) {
  try {
    // Token comes from the Authorization header as "Bearer whk_...".
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing webhook token' });
    }
    const token = authHeader.slice('Bearer '.length);

    const { text } = req.body;
    if (!text || String(text).trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    const message = await postViaWebhook(token, String(text).trim());
    return res.status(201).json({ posted: true, message });
  } catch (err: any) {
    if (err.message === 'INVALID_TOKEN') {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }
    console.error('Webhook inbound error:', err);
    return res.status(500).json({ error: 'Could not post message' });
  }
}
