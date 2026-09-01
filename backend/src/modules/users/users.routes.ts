import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { updateAvailability } from './users.controller';

const router = Router();
router.use(requireAuth);

router.patch('/me/availability', updateAvailability);

export default router;
