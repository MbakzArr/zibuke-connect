import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { create, mine, assignedByMe, monthDates, dueSoon, setStatus, update, remove } from './tasks.controller';

const router = Router();
router.use(requireAuth);

router.post('/', create);
router.get('/mine', mine);
router.get('/assigned-by-me', assignedByMe);
router.get('/month', monthDates);
router.get('/due-soon', dueSoon);
router.patch('/:id/status', setStatus);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
