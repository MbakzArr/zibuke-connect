import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requestUpload, requestDownload } from './attachments.controller';

const router = Router();

router.use(requireAuth);

router.post('/upload-url', requestUpload);
router.get('/download-url', requestDownload);

export default router;
