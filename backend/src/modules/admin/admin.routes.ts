import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireAdmin } from '../../middleware/requireAdmin';
import { list, create, remove, restore, setRole } from './admin.controller';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/users', list);
router.post('/users', create);
router.delete('/users/:id', remove);
router.post('/users/:id/restore', restore);
router.patch('/users/:id/role', setRole);

export default router;
