import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireAdmin } from '../../middleware/requireAdmin';
import { list, create, remove, restore, setRole, setDepartment, resetPassword, setCandidateTaskPerm } from './admin.controller';

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
router.patch('/users/:id/candidate-task-permission', setCandidateTaskPerm);

export default router;
