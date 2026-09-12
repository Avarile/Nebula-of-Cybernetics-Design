import type { Ctx } from '../harness/context';

/**
 * The search service: collection definitions, record projection into
 * Meilisearch, querying, and the sync-status surface that says whether the
 * index still agrees with Postgres.
 *
 * Records are persisted with `wait=true` so the assertions that follow are
 * about search behaviour rather than about how fast the indexer happens to be.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const name = `apisuite_${stamp}`;
  ctx.ids.collectionName = name;

  // ------------------------------------------------------------- definitions

  await client.call({
    name: 'a standard user cannot define a collection',
    method: 'POST',
    path: '/search/collections',
    actor: 'user',
    body: { name: `rogue_${stamp}`, displayName: 'Rogue', fields: [] },
    expect: 403,
  });

  const collection = await client.call({
    name: 'admin defines a searchable collection',
    method: 'POST',
    path: '/search/collections',
    actor: 'admin',
    body: {
      name,
      displayName: 'API Suite Catalogue',
      description: 'Fixture collection created by the live API suite.',
      visibility: 'shared',
      fields: [
        {
          name: 'title',
          type: 'string',
          required: true,
          searchable: true,
          sortable: true,
        },
        { name: 'summary', type: 'string', searchable: true },
        { name: 'quantity', type: 'number', filterable: true, sortable: true },
        { name: 'tags', type: 'string[]', filterable: true },
        {
          name: 'status',
          type: 'string',
          filterable: true,
          enum: ['open', 'closed'],
        },
      ],
    },
    expect: 201,
    assert: (b) => (b?.name === name ? undefined : `name was ${b?.name}`),
  });

  if (!collection.ok) {
    client.skip(
      'search records',
      '/search/collections/{name}/records',
      'POST',
      'no collection',
    );
    return;
  }

  await client.call({
    name: 'a collection name must be a lower-case identifier',
    method: 'POST',
    path: '/search/collections',
    actor: 'admin',
    body: { name: 'Not A Name', displayName: 'Bad', fields: [] },
    expect: 400,
  });

  await client.call({
    name: 'a duplicate collection name is refused',
    method: 'POST',
    path: '/search/collections',
    actor: 'admin',
    body: { name, displayName: 'Duplicate', fields: [] },
    expect: [409, 400, 422],
  });

  await client.call({
    name: 'an unknown field type is rejected',
    method: 'POST',
    path: '/search/collections',
    actor: 'admin',
    body: {
      name: `badtype_${stamp}`,
      displayName: 'Bad type',
      fields: [{ name: 'x', type: 'geopoint' }],
    },
    expect: 400,
  });

  await client.call({
    name: 'admin lists collections',
    method: 'GET',
    path: '/search/collections',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((c) => c.name === name)
        ? undefined
        : 'the collection just defined is not listed';
    },
  });

  await client.call({
    name: 'admin reads the collection definition',
    method: 'GET',
    path: '/search/collections/{name}',
    params: { name },
    actor: 'admin',
    expect: 200,
    assert: (b) =>
      (b?.fields ?? []).length === 5
        ? undefined
        : `expected 5 fields, got ${b?.fields?.length}`,
  });

  await client.call({
    name: 'a standard user cannot read collection definitions',
    method: 'GET',
    path: '/search/collections/{name}',
    params: { name },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'an unknown collection is a 404',
    method: 'GET',
    path: '/search/collections/{name}',
    params: { name: `nosuch_${stamp}` },
    actor: 'admin',
    expect: 404,
  });

  // ----------------------------------------------------------------- records

  const persisted = await client.call({
    name: 'admin projects a batch of records into the index',
    method: 'POST',
    path: '/search/collections/{name}/records',
    params: { name },
    actor: 'admin',
    query: { wait: true },
    body: {
      records: [
        {
          externalId: 'widget-alpha',
          document: {
            title: 'Alpha widget',
            summary: 'The first widget in the catalogue.',
            quantity: 3,
            tags: ['hardware', 'alpha'],
            status: 'open',
          },
        },
        {
          externalId: 'gadget-beta',
          document: {
            title: 'Beta gadget',
            summary: 'A gadget, not a widget.',
            quantity: 9,
            tags: ['hardware'],
            status: 'closed',
          },
        },
        {
          externalId: 'service-gamma',
          document: {
            title: 'Gamma service',
            summary: 'A service offering, unrelated to widgets.',
            quantity: 0,
            tags: ['services'],
            status: 'open',
          },
        },
      ],
    },
    expect: 202,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : [];
      if (rows.length !== 3) return `expected 3 results, got ${rows.length}`;
      const notIndexed = rows.filter((r) => r.indexState !== 'INDEXED');
      return notIndexed.length
        ? `wait=true returned before indexing: ${notIndexed.map((r) => r.indexState).join(', ')}`
        : undefined;
    },
  });
  if (persisted.ok) ctx.ids.recordExternalId = 'widget-alpha';

  await client.call({
    name: 'a record missing a required field is rejected',
    method: 'POST',
    path: '/search/collections/{name}/records',
    params: { name },
    actor: 'admin',
    query: { wait: true },
    body: { records: [{ externalId: 'no-title', document: { quantity: 1 } }] },
    expect: [400, 422],
  });

  await client.call({
    name: 'a value outside a field’s enum is rejected',
    method: 'POST',
    path: '/search/collections/{name}/records',
    params: { name },
    actor: 'admin',
    query: { wait: true },
    body: {
      records: [
        {
          externalId: 'bad-status',
          document: { title: 'Bad', status: 'perhaps' },
        },
      ],
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'a value of the wrong type is rejected',
    method: 'POST',
    path: '/search/collections/{name}/records',
    params: { name },
    actor: 'admin',
    query: { wait: true },
    body: {
      records: [
        {
          externalId: 'bad-qty',
          document: { title: 'Bad', quantity: 'three' },
        },
      ],
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'admin reads a single record by its external id',
    method: 'GET',
    path: '/search/collections/{name}/records/{id}',
    params: { name, id: 'widget-alpha' },
    actor: 'admin',
    expect: 200,
    assert: (b) =>
      b?.document?.title === 'Alpha widget'
        ? undefined
        : `document was ${JSON.stringify(b?.document)}`,
  });

  await client.call({
    name: 'an unknown record id is a 404',
    method: 'GET',
    path: '/search/collections/{name}/records/{id}',
    params: { name, id: 'no-such-record' },
    actor: 'admin',
    expect: 404,
  });

  // ----------------------------------------------------------------- queries

  await client.call({
    name: 'a full-text query finds the matching record only',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: 'widget', limit: 10, highlight: ['title'] },
    expect: 200,
    assert: (b) => {
      const hits: any[] = b?.hits ?? [];
      if (hits.length === 0) return 'no hits for a term that is present';
      if (!hits.some((h) => h.externalId === 'widget-alpha')) {
        return 'the exact match is missing from the hits';
      }
      const highlighted = hits.find((h) =>
        h._formatted?.title?.includes('<em>'),
      );
      return highlighted
        ? undefined
        : 'highlighting was requested but not applied';
    },
  });

  await client.call({
    name: 'a filter narrows the result set',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: '', filters: { status: 'open' }, limit: 20 },
    expect: 200,
    assert: (b) => {
      const hits: any[] = b?.hits ?? [];
      if (hits.length !== 2)
        return `expected 2 open records, got ${hits.length}`;
      const closed = hits.find((h) => h.status !== 'open');
      return closed ? 'the filter leaked a closed record' : undefined;
    },
  });

  await client.call({
    name: 'facets are returned when asked for',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: '', facets: ['tags'], limit: 20 },
    expect: 200,
    assert: (b) => {
      const facets = b?.facetDistribution?.tags;
      if (!facets) return 'no facet distribution returned';
      return facets.hardware === 2
        ? undefined
        : `hardware facet counted ${facets.hardware}`;
    },
  });

  await client.call({
    name: 'results can be sorted',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: '', sort: ['quantity:desc'], limit: 20 },
    expect: 200,
    assert: (b) => {
      const hits: any[] = b?.hits ?? [];
      const quantities = hits.map((h) => h.quantity);
      const sorted = [...quantities].sort((a, c) => c - a);
      return JSON.stringify(quantities) === JSON.stringify(sorted)
        ? undefined
        : `results are not descending: ${quantities.join(', ')}`;
    },
  });

  await client.call({
    name: 'paging is honoured',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: '', page: 1, limit: 2 },
    expect: 200,
    assert: (b) => {
      if ((b?.hits ?? []).length !== 2)
        return `page size not applied: ${b?.hits?.length} hits`;
      return b?.totalHits === 3 ? undefined : `totalHits was ${b?.totalHits}`;
    },
  });

  await client.call({
    name: 'a page number of zero is rejected',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: '', page: 0 },
    expect: 400,
  });

  await client.call({
    name: 'an agent can query a shared collection',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'agent',
    body: { q: 'gadget', limit: 5 },
    expect: 200,
  });

  await client.call({
    name: 'querying requires authentication',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'anon',
    body: { q: 'widget' },
    expect: 401,
  });

  // ------------------------------------------------------------ sync + admin

  await client.call({
    name: 'admin reads the collection’s sync status',
    method: 'GET',
    path: '/search/collections/{name}/sync-status',
    params: { name },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      if (b?.counts?.indexed !== 3)
        return `indexed count was ${b?.counts?.indexed}`;
      if (b?.counts?.failed > 0)
        return `${b.counts.failed} records failed to index`;
      return undefined;
    },
  });

  await client.call({
    name: 'admin reads the global sync status',
    method: 'GET',
    path: '/search/sync-status',
    actor: 'admin',
    expect: 200,
  });

  await client.call({
    name: 'a standard user cannot read sync status',
    method: 'GET',
    path: '/search/sync-status',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin widens the collection definition',
    method: 'PATCH',
    path: '/search/collections/{name}',
    params: { name },
    actor: 'admin',
    body: { description: 'Amended by the live API suite.' },
    expect: 200,
    assert: (b) =>
      b?.description === 'Amended by the live API suite.'
        ? undefined
        : `description was ${b?.description}`,
  });

  await client.call({
    name: 'admin triggers a reindex',
    method: 'POST',
    path: '/search/collections/{name}/reload',
    params: { name },
    actor: 'admin',
    expect: [200, 201, 202],
  });

  await client.call({
    name: 'a standard user cannot trigger a reindex',
    method: 'POST',
    path: '/search/collections/{name}/reload',
    params: { name },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin deletes a record',
    method: 'DELETE',
    path: '/search/collections/{name}/records/{id}',
    params: { name, id: 'service-gamma' },
    actor: 'admin',
    expect: 204,
  });

  // Deletion is asynchronous: it soft-deletes in Postgres and enqueues an index
  // job, and unlike `persist` it takes no `wait`. So the record stays
  // searchable for as long as the queue takes, and asserting immediately races
  // the indexer rather than testing it. Wait for the projection to settle, then
  // assert — a timeout here is a real failure, not a slow machine.
  const settled = await waitForRemoval(ctx, name, 'service-gamma');
  client.assert(
    'the delete is projected out of the index within the timeout',
    'DELETE',
    '/search/collections/{name}/records/{id}',
    settled ? undefined : `still searchable after ${REMOVAL_TIMEOUT_MS}ms`,
  );

  await client.call({
    name: 'the deleted record is gone from the index',
    method: 'POST',
    path: '/search/collections/{name}/query',
    params: { name },
    actor: 'user',
    body: { q: 'Gamma', limit: 10 },
    expect: 200,
    assert: (b) => {
      const hits: any[] = b?.hits ?? [];
      return hits.some((h) => h.externalId === 'service-gamma')
        ? 'a deleted record is still searchable'
        : undefined;
    },
  });
}

/** How long the indexer gets to project a delete before it counts as broken. */
const REMOVAL_TIMEOUT_MS = 15_000;

/**
 * Polls the query endpoint until `externalId` stops matching.
 *
 * Raw fetches rather than `client.call`, so a dozen polling requests do not
 * land in the results as a dozen checks; the single verdict is recorded by the
 * caller.
 */
async function waitForRemoval(
  ctx: Ctx,
  collection: string,
  externalId: string,
): Promise<boolean> {
  const { client, baseUrl } = ctx;
  const deadline = Date.now() + REMOVAL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${baseUrl}/search/collections/${collection}/query`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${client.principal('admin').accessToken}`,
        },
        body: JSON.stringify({ q: '', limit: 50 }),
      },
    ).catch(() => undefined);

    if (res?.ok) {
      const body = (await res.json()) as {
        hits?: Array<{ externalId?: string }>;
      };
      if (!(body.hits ?? []).some((h) => h.externalId === externalId))
        return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
