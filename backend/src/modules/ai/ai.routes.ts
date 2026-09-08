import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { summarize, rewrite } from './ai.controller';

const router = Router();

router.use(requireAuth);

router.post('/summarize-channel', summarize);
router.post('/rewrite', rewrite);

export default router;
