import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, create } from './announcements.controller';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);

export default router;
