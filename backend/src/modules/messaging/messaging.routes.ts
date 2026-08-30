import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { history, edit, remove, search } from './messaging.controller';

const router = Router();

router.use(requireAuth);

// Message history for a channel.
router.get('/search', search);
router.get('/channel/:channelId', history);

// Edit or delete a single message by its id.
router.patch('/:id', edit);
router.delete('/:id', remove);

export default router;
