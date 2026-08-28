import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, read, readAll } from './notifications.controller';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.patch('/read-all', readAll);
router.patch('/:id/read', read);

export default router;
