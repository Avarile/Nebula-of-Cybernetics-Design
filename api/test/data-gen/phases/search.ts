import { create, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * Search collections and the records projected into them.
 *
 * Records are written in batches: `POST /collections/{name}/records` takes up
 * to 1000 per call, and sending them one at a time would spend the run's whole
 * throttle budget on this phase alone.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  client.beginSuite('search');

  const VISIBILITIES = ['private', 'shared', 'owner_scoped'] as const;

  for (let i = 0; i < scaled(VOLUME.collections); i += 1) {
    const visibility = f.pick(VISIBILITIES, i);
    const name = `gen_${f.topic(i).replace(/\s+/g, '_')}_${i}_${stamp}`
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 100);
    const created = await create(ctx, 'collections', {
      name: `collection ${name}`,
      method: 'POST',
      path: '/search/collections',
      actor: 'admin',
      body: {
        name,
        displayName: `Generated ${f.topic(i)} index`,
        description: `Records generated for run ${stamp}.`,
        fields: [
          {
            name: 'title',
            type: 'string',
            required: true,
            searchable: true,
            sortable: true,
          },
          { name: 'body', type: 'string', searchable: true },
          { name: 'category', type: 'string', filterable: true },
          { name: 'score', type: 'number', filterable: true, sortable: true },
          { name: 'active', type: 'boolean', filterable: true },
          { name: 'labels', type: 'string[]', filterable: true },
          // `owner_scoped` reads this field to decide who may see a row, so it
          // has to exist and be filterable for the collection to validate.
          { name: 'ownerId', type: 'string', filterable: true },
        ],
        visibility,
        ...(visibility === 'owner_scoped' ? { ownerField: 'ownerId' } : {}),
      },
      expect: 201,
    });
    if (created) pools.collectionNames.push(name);
  }

  if (pools.collectionNames.length === 0) return;

  // Batched: 25 records per call keeps each payload small while still costing
  // only a handful of calls against the throttle.
  const BATCH = 25;
  const owners = [
    ctx.adminUserId,
    ctx.mockUserId,
    ...pools.extraUserIds,
  ].filter(Boolean);
  let written = 0;
  let i = 0;
  while (written < scaled(VOLUME.searchRecords)) {
    const size = Math.min(BATCH, scaled(VOLUME.searchRecords) - written);
    const collection = f.pick(pools.collectionNames, i);
    const records = Array.from({ length: size }, (_, n) => {
      const idx = written + n;
      return {
        externalId: `gen-${stamp}-${idx}`,
        document: {
          title: `${f.knowledgeTitle(idx)} ${idx}`,
          body: f.paragraph(idx, 4),
          category: f.industry(idx),
          score: (idx * 17) % 100,
          active: idx % 3 !== 0,
          labels: [f.topic(idx), f.topic(idx * 3 + 1)],
          ownerId: f.pick(owners, idx),
        },
      };
    });

    const res = await ctx.client.call({
      name: `persist ${size} records into ${collection}`,
      method: 'POST',
      path: '/search/collections/{name}/records',
      params: { name: collection },
      actor: 'admin',
      body: { records },
      expect: [200, 201, 202],
    });
    if (res.ok) {
      // Counted per record, not per call: the report is about rows created.
      for (let n = 0; n < size; n += 1) ctx.report.ok('search_records');
    } else {
      ctx.report.bad(
        'search_records',
        res.status,
        JSON.stringify(res.body ?? {}),
      );
    }
    written += size;
    i += 1;
  }
}
