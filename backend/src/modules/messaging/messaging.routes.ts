import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { create, history, edit, remove, restore, search, recent } from './messaging.controller';

const router = Router();

router.use(requireAuth);

// Send a message over plain REST. The socket path (message:send) still
// exists and is what Render/the Node backend actually uses day to day -
// this REST route is what makes sending work at all on a deploy target
// that doesn't have a socket server yet (see the comment in
// messaging.controller.ts's create()).
router.post('/', create);

// Message history for a channel.
router.get('/search', search);
router.get('/recent', recent);
router.get('/channel/:channelId', history);

// Edit, delete, or undo-delete a single message by its id.
router.patch('/:id', edit);
router.delete('/:id', remove);
router.post('/:id/restore', restore);

export default router;
