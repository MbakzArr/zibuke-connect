import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { list, getOne, create, join, listJoinRequests, respondToJoinRequest, leave, clearForMe, remove, addMember, members, openDm, listDms, browse, searchPlaces, markRead, readStatus } from './channels.controller';

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
router.post('/:id/members', addMember);
router.get('/:id/read-status', readStatus);
router.post('/:id/join', join);
router.get('/:id/join-requests', listJoinRequests);
router.post('/:channelId/join-requests/:requestId', respondToJoinRequest);
router.patch('/:id/read', markRead);
router.post('/:id/leave', leave);
router.post('/:id/clear', clearForMe);
router.delete('/:id', remove);

export default router;
