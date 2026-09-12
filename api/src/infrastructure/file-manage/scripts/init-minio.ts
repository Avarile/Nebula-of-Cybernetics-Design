import { config as loadEnv } from 'dotenv';
import { Client } from 'minio';
import { validateEnv } from '../../../config/env.validation';

/**
 * MinIO init script (`pnpm storage:init`). Standalone runner — decoupled from
 * runtime DI, mirroring the seed runner. Idempotent and safe to re-run:
 *   1. ensure the app bucket exists,
 *   2. apply lifecycle rules (abort abandoned multipart uploads; expire tmp/).
 *
 * Buckets are private by default in MinIO — no anonymous policy is set, so all
 * access flows through presigned URLs.
 */
async function initMinio(): Promise<void> {
  loadEnv();
  const env = validateEnv(process.env);
  const client = new Client({
    endPoint: env.MINIO_HOST,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    region: env.MINIO_REGION,
  });

  const bucket = env.MINIO_BUCKET;

  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, env.MINIO_REGION);
    console.log(`Created bucket "${bucket}".`);
  } else {
    console.log(`Bucket "${bucket}" already exists.`);
  }

  // Expire the tmp/ scratch prefix after a day. Abort-incomplete-multipart-upload
  // cleanup is intentionally omitted: the minio JS SDK v8 cannot serialise that
  // rule (InvalidArgument), and presigned single PUT/POST uploads don't create
  // multipart uploads anyway. Configure it via `mc ilm` if large multipart
  // uploads are later introduced.
  await client.setBucketLifecycle(bucket, {
    Rule: [
      {
        ID: 'expire-tmp-prefix',
        Status: 'Enabled',
        Filter: { Prefix: 'tmp/' },
        Expiration: { Days: 1 },
      },
    ],
  });
  console.log(`Applied lifecycle rules to "${bucket}".`);
  console.log('MinIO initialization complete.');
}

initMinio().catch((error) => {
  console.error('MinIO initialization failed:', error);
  process.exit(1);
});
