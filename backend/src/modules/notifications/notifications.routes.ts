import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, read, readAll, readDmChannel } from './notifications.controller';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.patch('/read-all', readAll);
router.patch('/dm/:channelId/read', readDmChannel);
router.patch('/:id/read', read);

export default router;
