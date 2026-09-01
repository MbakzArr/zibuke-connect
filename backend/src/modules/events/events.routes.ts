import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { create, forDate, month, update, remove } from './events.controller';

const router = Router();
router.use(requireAuth);

// Literal paths before the more general date-query one.
router.get('/month', month);
router.get('/today', forDate); // kept for compatibility with existing calls
router.get('/', forDate); // ?date=YYYY-MM-DD, defaults to today
router.post('/', create);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
