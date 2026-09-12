import { createHash } from 'node:crypto';
import type { Ctx } from '../harness/context';

/**
 * The presigned upload lifecycle, driven all the way through object storage.
 *
 * The API never sees the bytes: it hands back a presigned POST policy, the
 * client uploads straight to MinIO, and only then does `complete` promote the
 * record from PENDING to AVAILABLE. Testing the two API halves without the
 * middle step would prove nothing — a policy that MinIO rejects still returns
 * 201 from `POST /files`. So this suite performs the real upload.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const content = Buffer.from(
    `Cybernetics live API suite fixture.\nRun: ${stamp}\n`,
    'utf8',
  );
  const sha256 = createHash('sha256').update(content).digest('hex');

  const initiated = await client.call({
    name: 'user initiates a presigned upload',
    method: 'POST',
    path: '/files',
    actor: 'user',
    body: {
      filename: `api-suite-${stamp}.txt`,
      mimeType: 'text/plain',
      size: content.length,
      sha256,
      metadata: { source: 'live-api-suite', run: stamp },
    },
    expect: 201,
    assert: (b) => {
      if (!b?.fileId) return 'no fileId returned';
      if (!b?.upload?.url || !b?.upload?.fields)
        return 'no presigned POST policy returned';
      return undefined;
    },
  });

  if (!initiated.ok) {
    client.skip(
      'upload to object storage',
      '/files/{id}/complete',
      'POST',
      'presign failed, so there is nothing to upload',
    );
    return;
  }

  ctx.ids.fileId = initiated.body.fileId;
  const policy = initiated.body.upload as {
    url: string;
    fields: Record<string, string>;
  };

  // Straight to MinIO with the policy the API just issued. Not an API call, so
  // it is recorded as an assertion rather than counted toward endpoint coverage.
  const uploadStatus = await postToStorage(
    policy,
    content,
    `api-suite-${stamp}.txt`,
  );
  client.assert(
    'the presigned policy is accepted by object storage',
    'POST',
    '(object storage)',
    uploadStatus >= 200 && uploadStatus < 400
      ? undefined
      : `storage returned ${uploadStatus}`,
  );

  await client.call({
    name: 'a PENDING file has no download URL yet',
    method: 'GET',
    path: '/files/{id}/download-url',
    params: { id: ctx.ids.fileId! },
    actor: 'user',
    expect: [400, 404, 409, 422],
  });

  await client.call({
    name: 'user completes the upload',
    method: 'POST',
    path: '/files/{id}/complete',
    params: { id: ctx.ids.fileId! },
    actor: 'user',
    body: { sha256 },
    expect: [200, 201],
    assert: (b) => {
      if (b?.status !== 'AVAILABLE') return `status was ${b?.status}`;
      if (b?.checksumSha256 !== sha256)
        return 'stored checksum does not match the uploaded bytes';
      if (b?.size !== content.length)
        return `size was ${b?.size}, uploaded ${content.length}`;
      return undefined;
    },
  });

  await client.call({
    name: 'user reads the file metadata',
    method: 'GET',
    path: '/files/{id}',
    params: { id: ctx.ids.fileId! },
    actor: 'user',
    expect: 200,
    assert: (b) =>
      b?.ownerId === client.principal('user').userId
        ? undefined
        : `owner was ${b?.ownerId}`,
  });

  const download = await client.call({
    name: 'user gets a presigned download URL',
    method: 'GET',
    path: '/files/{id}/download-url',
    params: { id: ctx.ids.fileId! },
    actor: 'user',
    query: { ttl: 300 },
    expect: 200,
    assert: (b) => (b?.url ? undefined : 'no URL returned'),
  });

  if (download.ok) {
    const fetched = await fetch(download.body.url).catch(() => undefined);
    const roundTripped = fetched
      ? Buffer.from(await fetched.arrayBuffer())
      : undefined;
    client.assert(
      'the downloaded bytes are the bytes that were uploaded',
      'GET',
      '(object storage)',
      roundTripped && roundTripped.equals(content)
        ? undefined
        : `round-trip failed (status ${fetched?.status ?? 'network error'})`,
    );
  }

  await client.call({
    name: 'user lists its own files',
    method: 'GET',
    path: '/files',
    actor: 'user',
    query: { page: 1, limit: 20, status: 'AVAILABLE' },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.items ?? b?.data ?? [];
      if (!rows.some((f) => f.id === ctx.ids.fileId))
        return 'the uploaded file is not listed';
      const wrongStatus = rows.find((f) => f.status !== 'AVAILABLE');
      return wrongStatus
        ? `status filter leaked a ${wrongStatus.status} file`
        : undefined;
    },
  });

  await client.call({
    name: 'files can be filtered by MIME type',
    method: 'GET',
    path: '/files',
    actor: 'user',
    query: { mimeType: 'text/plain', limit: 10 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.items ?? b?.data ?? [];
      const foreign = rows.find((f) => f.mimeType !== 'text/plain');
      return foreign ? `mimeType filter leaked ${foreign.mimeType}` : undefined;
    },
  });

  // ---------------------------------------------------------- negative paths

  await client.call({
    name: 'a checksum that does not match the stored object is rejected',
    method: 'POST',
    path: '/files/{id}/complete',
    params: { id: ctx.ids.fileId! },
    actor: 'user',
    body: { sha256: 'f'.repeat(64) },
    expect: [400, 409, 422],
  });

  await client.call({
    name: 'a malformed sha256 is rejected before storage is touched',
    method: 'POST',
    path: '/files',
    actor: 'user',
    body: {
      filename: 'bad.txt',
      mimeType: 'text/plain',
      size: 10,
      sha256: 'not-a-hash',
    },
    expect: 400,
  });

  await client.call({
    name: 'a negative file size is rejected',
    method: 'POST',
    path: '/files',
    actor: 'user',
    body: { filename: 'bad.txt', mimeType: 'text/plain', size: -1 },
    expect: [400, 422],
  });

  await client.call({
    name: 'file access requires authentication',
    method: 'GET',
    path: '/files/{id}',
    params: { id: ctx.ids.fileId! },
    actor: 'anon',
    expect: 401,
  });

  await client.call({
    name: 'an unknown file id is a 404',
    method: 'GET',
    path: '/files/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    expect: 404,
  });

  // A second file exists so DELETE is covered without removing the fixture the
  // attachments suite is about to reference.
  const spare = await client.call({
    name: 'user initiates a second upload to exercise deletion',
    method: 'POST',
    path: '/files',
    actor: 'user',
    body: {
      filename: `api-suite-spare-${stamp}.txt`,
      mimeType: 'text/plain',
      size: 12,
    },
    expect: 201,
  });

  if (spare.ok) {
    await client.call({
      name: 'user soft-deletes the spare file',
      method: 'DELETE',
      path: '/files/{id}',
      params: { id: spare.body.fileId },
      actor: 'user',
      expect: 204,
    });

    await client.call({
      name: 'the deleted file is no longer readable',
      method: 'GET',
      path: '/files/{id}',
      params: { id: spare.body.fileId },
      actor: 'user',
      expect: 404,
    });
  }
}

/** Perform the presigned POST exactly as a browser form would. */
async function postToStorage(
  policy: { url: string; fields: Record<string, string> },
  content: Buffer,
  filename: string,
): Promise<number> {
  const form = new FormData();
  for (const [key, value] of Object.entries(policy.fields)) {
    form.append(key, String(value));
  }
  // The file part must come last — S3 policy evaluation ignores anything after it.
  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  form.append('file', new Blob([bytes], { type: 'text/plain' }), filename);
  try {
    const res = await fetch(policy.url, { method: 'POST', body: form });
    return res.status;
  } catch {
    return 0;
  }
}
