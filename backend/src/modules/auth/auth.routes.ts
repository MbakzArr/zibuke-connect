import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, refresh } from './auth.controller';

const router = Router();

// Auth endpoints get their own, tighter rate limit than the rest of the API,
// since they're the main target for credential stuffing / brute force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many attempts, please try again later' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh', refresh);

export default router;
