import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { create, list, remove, inbound } from './webhooks.controller';

const router = Router();

// The inbound endpoint is a public POST authenticated only by the webhook
// token, so it needs its own rate limit to blunt token-guessing and
// flooding. Not express-rate-limit here - see the comment in
// auth.routes.ts for why (crashes at startup on Workers, and its
// in-memory store wouldn't share state across isolates anyway). Same
// replacement: a Cloudflare rate limiting rule on POST
// /api/v1/webhooks/inbound (e.g. 60 requests per minute per IP,
// matching what this used to do).
router.post('/inbound', inbound);

// Everything below requires a logged-in admin.
router.use(requireAuth);
router.get('/', list);
router.post('/', create);
router.delete('/:id', remove);

export default router;
