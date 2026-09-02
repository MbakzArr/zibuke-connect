import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { history, edit, remove, restore, search, recent } from './messaging.controller';

const router = Router();

router.use(requireAuth);

// Message history for a channel.
router.get('/search', search);
router.get('/recent', recent);
router.get('/channel/:channelId', history);

// Edit, delete, or undo-delete a single message by its id.
router.patch('/:id', edit);
router.delete('/:id', remove);
router.post('/:id/restore', restore);

export default router;
