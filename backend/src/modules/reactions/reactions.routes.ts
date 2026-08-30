import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { toggle, listForTargets } from './reactions.controller';

const router = Router();
router.use(requireAuth);

router.get('/', listForTargets);
router.post('/toggle', toggle);

export default router;
