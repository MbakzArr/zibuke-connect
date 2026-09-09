import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { summarize, rewrite, extract, ask } from './ai.controller';

const router = Router();

router.use(requireAuth);

router.post('/summarize-channel', summarize);
router.post('/rewrite', rewrite);
router.post('/extract-task', extract);
router.post('/ask', ask);

export default router;
