import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireAdmin } from '../../middleware/requireAdmin';
import { list, create, remove, restore, setRole, setDepartment, resetPassword } from './admin.controller';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/users', list);
router.post('/users', create);
router.delete('/users/:id', remove);
router.post('/users/:id/restore', restore);
router.patch('/users/:id/role', setRole);
router.patch('/users/:id/department', setDepartment);
router.patch('/users/:id/reset-password', resetPassword);

export default router;
