import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, getOne, create, update, remove } from './departments.controller';

const router = Router();

// Every department route requires a valid token.
router.use(requireAuth);

router.get('/', list);
router.get('/:id', getOne);
router.post('/', create);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
