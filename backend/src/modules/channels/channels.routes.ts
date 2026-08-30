import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, getOne, create, join, leave, members, openDm, listDms, browse, searchPlaces } from './channels.controller';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.get('/dm', listDms);
router.get('/browse', browse);
router.get('/search', searchPlaces);
router.post('/dm/:userId', openDm);
router.get('/:id', getOne);
router.get('/:id/members', members);
router.post('/:id/join', join);
router.post('/:id/leave', leave);

export default router;
