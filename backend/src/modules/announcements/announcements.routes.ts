import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, create, getOne } from './announcements.controller';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.get('/:id', getOne);
router.post('/', create);

export default router;
