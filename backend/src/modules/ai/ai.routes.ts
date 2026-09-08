import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { summarize } from './ai.controller';

const router = Router();

router.use(requireAuth);

router.post('/summarize-channel', summarize);

export default router;
