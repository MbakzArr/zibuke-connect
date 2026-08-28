import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { search, list, profile, updateMe } from './directory.controller';

const router = Router();

router.use(requireAuth);

// Order matters: /search and /me are literal paths, they must be declared
// before /:id so Express doesn't treat "search" or "me" as an id.
router.get('/search', search);
router.patch('/me', updateMe);
router.get('/', list);
router.get('/:id', profile);

export default router;
