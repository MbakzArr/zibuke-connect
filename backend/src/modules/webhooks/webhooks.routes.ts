import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../middleware/requireAuth';
import { create, list, remove, inbound } from './webhooks.controller';

const router = Router();

// The inbound endpoint is a public POST authenticated only by the webhook
// token, so it needs its own rate limit to blunt token-guessing and flooding.
const inboundLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // 60 messages/min per IP is plenty for a real integration
  message: { error: 'Too many webhook posts, slow down' },
});

// The inbound post route is authenticated by the webhook token itself, so it
// must NOT be behind requireAuth. Declared first, before the auth middleware.
router.post('/inbound', inboundLimiter, inbound);

// Everything below requires a logged-in admin.
router.use(requireAuth);
router.get('/', list);
router.post('/', create);
router.delete('/:id', remove);

export default router;
