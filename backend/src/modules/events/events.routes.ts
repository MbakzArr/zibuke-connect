import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { create, today } from './events.controller';

const router = Router();
router.use(requireAuth);

router.get('/today', today);
router.post('/', create);

export default router;
