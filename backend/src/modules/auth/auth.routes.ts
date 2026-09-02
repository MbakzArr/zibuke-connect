import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, refresh } from './auth.controller';

const router = Router();

// Auth endpoints get their own, tighter rate limit than the rest of the API,
// since they're the main target for credential stuffing / brute force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many attempts, please try again later' },
});

// NOTE: there used to be an open POST /register here. It took a raw
// organizationId from the request body with no invite/approval check -
// and since organizationId is embedded in every access token (JWTs are
// signed, not encrypted, so anyone can decode their own), any current OR
// former employee could read their org id and self-register a brand new
// account, completely bypassing admin control over who's on the team.
// Account creation now only happens through POST /api/v1/admin/users
// (admin-only, see modules/admin), which does the same job properly.
router.post('/login', authLimiter, login);
router.post('/refresh', refresh);

export default router;
