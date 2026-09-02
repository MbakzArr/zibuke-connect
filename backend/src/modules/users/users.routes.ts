import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { updateAvailability, changePassword } from './users.controller';

const router = Router();
router.use(requireAuth);

router.patch('/me/availability', updateAvailability);
router.patch('/me/password', changePassword);

export default router;
