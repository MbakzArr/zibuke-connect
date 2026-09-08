import { S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2 is S3-compatible, so the same AWS SDK client works against
// it - just point the endpoint at R2 instead of AWS, and use 'auto' as the
// region (R2 ignores region, but the SDK still requires one to be set).
// This is the one piece of storage infrastructure genuinely shared,
// unmodified, by both platforms this app runs on: generating a presigned
// URL is pure request-signing (HMAC-SHA256), not an actual network call,
// so it needs no platform-specific code the way the realtime layer did -
// Render calls the resulting URL over HTTPS like any other S3-compatible
// API, and so does a browser talking to the Cloudflare deployment.
export function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    // Newer AWS SDK versions auto-attach a checksum requirement
    // (x-amz-sdk-checksum-algorithm) to presigned PUT URLs by default. A
    // plain browser fetch() upload, which is what actually performs the
    // upload here, never computes or sends that checksum, so R2 rejects
    // the mismatch with a 400 - this turns that default back off, since
    // nothing here needs SDK-side checksum verification.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'zibuke-connect-attachments';
