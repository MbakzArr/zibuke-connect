import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Client, R2_BUCKET } from '../../util/r2';

// Kept short and specific rather than a blanket allow-list - matches what
// "reporting with documents" actually means in practice: office documents,
// PDFs, images, and plain text/CSV. Deliberately excludes anything
// executable or archive-based, which is where most attachment-based
// attacks come from.
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB - generous for documents, not for video

// Asks R2 for a short-lived URL the client can upload straight to,
// bypassing the API server entirely for the actual file bytes - the
// server's job here is just to check the file is allowed and issue a
// signed permission slip, not to sit in the middle of every upload.
export async function createPresignedUpload(organizationId: string, fileName: string, fileType: string, fileSize: number) {
  if (!ALLOWED_TYPES.has(fileType)) {
    throw new Error('UNSUPPORTED_TYPE');
  }
  if (fileSize > MAX_SIZE_BYTES) {
    throw new Error('TOO_LARGE');
  }
  if (!fileName || !fileName.trim()) {
    throw new Error('MISSING_NAME');
  }

  // Namespaced by org, then a random id - never trust the original
  // filename as part of the storage path (path traversal, collisions);
  // the real filename is kept separately, in Postgres, for display.
  const key = `${organizationId}/${crypto.randomUUID()}`;

  const client = getR2Client();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: fileType }),
    { expiresIn: 300 } // 5 minutes to actually perform the upload
  );

  return { uploadUrl, key };
}

// Same idea in reverse - a short-lived URL to fetch the file, generated
// fresh each time someone actually clicks to download rather than a
// permanent public link, so nothing about a shared file's URL stays valid
// forever.
export async function createPresignedDownload(key: string) {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn: 300 }
  );
}
