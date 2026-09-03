import { Router } from 'express';
import { login, refresh } from './auth.controller';

const router = Router();

// The Node/Render version of this file rate-limits login attempts with
// express-rate-limit's in-memory store. That doesn't translate to
// Workers for two separate reasons, not just one:
//   1. Its default store calls setInterval() the moment the limiter is
//      created, to periodically sweep expired counters - and Workers
//      flatly disallows timers outside of an actual request handler
//      (this crashed the whole worker on startup: "Disallowed operation
//      called within global scope").
//   2. Even if that crash is worked around, an in-memory counter only
//      lives inside ONE isolate. Cloudflare runs many isolates across
//      many edge locations - an attacker's requests would mostly land on
//      DIFFERENT isolates, each with its own independent counter, so the
//      limit would barely apply at all. This isn't an Express problem to
//      patch, it's a real mismatch between "one counter in one process"
//      and how Workers actually scales.
//
// The right replacement is Cloudflare's own native rate limiting, which
// runs at the edge, shares state correctly across every location, and
// doesn't need a single line of app code: dashboard -> this Worker's
// route -> Security -> Rate limiting rules -> a rule on POST
// /api/v1/auth/login (e.g. 20 requests per 15 minutes per IP, matching
// what this used to do). See PART 6 notes for the exact walkthrough.
router.post('/login', login);
router.post('/refresh', refresh);

export default router;
