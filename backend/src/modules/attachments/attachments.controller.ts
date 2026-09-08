import { Request, Response } from 'express';
import { createPresignedUpload, createPresignedDownload } from './attachments.service';

// Called before a message is actually sent - the client uploads the file
// to R2 using the returned URL, then sends the message with the returned
// key attached. requireAuth (applied at the router level) is the only
// permission check needed here: any signed-in member of the org can
// request to upload something, the same as they can already post a
// message.
export async function requestUpload(req: Request, res: Response) {
  try {
    const { fileName, fileType, fileSize } = req.body;
    if (!fileName || !fileType || typeof fileSize !== 'number') {
      return res.status(400).json({ error: 'fileName, fileType and fileSize are required' });
    }
    const { uploadUrl, key } = await createPresignedUpload(req.user!.organizationId, fileName, fileType, fileSize);
    return res.json({ uploadUrl, key });
  } catch (err: any) {
    if (err.message === 'UNSUPPORTED_TYPE') {
      return res.status(400).json({ error: 'That file type isn\u2019t supported. Try a PDF, Word/Excel/PowerPoint document, image, or text file.' });
    }
    if (err.message === 'TOO_LARGE') {
      return res.status(400).json({ error: 'That file is too large - the limit is 15MB.' });
    }
    if (err.message === 'MISSING_NAME') {
      return res.status(400).json({ error: 'fileName is required' });
    }
    console.error('Request upload error:', err);
    return res.status(500).json({ error: 'Could not prepare that upload' });
  }
}

// Called when someone clicks to download an attachment already on a
// message they can already see - access to the attachment is really
// governed by whether they can see the message it's on (enforced by the
// normal message-history endpoints), this just hands back a working link
// for a key the client already legitimately has. The key is a query
// param, not a path segment - it contains a "/" (organizationId/uuid),
// which would otherwise get split across two route segments.
export async function requestDownload(req: Request, res: Response) {
  try {
    const key = req.query.key as string;
    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }
    // Attachment keys are namespaced by organization id - refuse to
    // generate a link for a key belonging to a different org, even
    // though guessing another org's random key is already infeasible.
    if (!key.startsWith(`${req.user!.organizationId}/`)) {
      return res.status(403).json({ error: 'Not found' });
    }
    const downloadUrl = await createPresignedDownload(key);
    return res.json({ downloadUrl });
  } catch (err) {
    console.error('Request download error:', err);
    return res.status(500).json({ error: 'Could not generate a download link' });
  }
}
