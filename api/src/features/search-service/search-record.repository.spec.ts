import { SearchRecordRepository } from './search-record.repository';

/**
 * Fake Drizzle query builder. Captures the `.set()` payload and the compiled
 * SQL fragments so the tests can assert on the shape of the statement without
 * a live Postgres — the behaviours under test here (which columns an index
 * stamp writes, what the sweep filters and orders by) are exactly the ones a
 * mocked repository in a service test cannot catch.
 */
function makeDb() {
  const captured = {
    set: undefined as Record<string, unknown> | undefined,
    where: undefined as unknown,
    orderBy: undefined as unknown,
    limit: undefined as number | undefined,
    values: undefined as unknown,
    onConflict: undefined as Record<string, unknown> | undefined,
  };

  const selectChain: Record<string, unknown> = {};
  Object.assign(selectChain, {
    from: () => selectChain,
    where: (w: unknown) => {
      captured.where = w;
      return selectChain;
    },
    orderBy: (o: unknown) => {
      captured.orderBy = o;
      return selectChain;
    },
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve([]);
    },
    then: (resolve: (v: unknown[]) => unknown) => resolve([]),
  });

  const db = {
    select: () => selectChain,
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        captured.set = payload;
        return {
          where: (w: unknown) => {
            captured.where = w;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        captured.values = v;
        return {
          onConflictDoUpdate: (cfg: Record<string, unknown>) => {
            captured.onConflict = cfg;
            return { returning: () => Promise.resolve([]) };
          },
        };
      },
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve([{ id: 'a' }]) }),
    }),
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
  };

  return { db, captured };
}

function make() {
  const { db, captured } = makeDb();
  return { repo: new SearchRecordRepository(db as never), captured };
}

/**
 * Render a captured Drizzle SQL fragment to comparable text by walking its
 * query chunks. `JSON.stringify` cannot be used: a column chunk holds a
 * back-reference to its table, so the graph is circular.
 */
function sqlText(fragment: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    // StringChunk: literal SQL text.
    if (Array.isArray(n.value) && n.value.every((v) => typeof v === 'string')) {
      parts.push(...(n.value as string[]));
      return;
    }
    // Column: contributes its name (bound params contribute nothing).
    if (typeof n.name === 'string' && 'table' in n) {
      parts.push(n.name);
      return;
    }
    // Nested SQL.
    if (Array.isArray(n.queryChunks)) visit(n.queryChunks);
  };
  visit(fragment);
  return parts.join(' ');
}

describe('SearchRecordRepository index stamps', () => {
  // The whole point of splitting indexAttemptedAt out of updatedAt: an index
  // stamp must not look like a content change, or `updatedAt > indexedAt`
  // reports drift on every successfully indexed record.
  it('never moves updatedAt to "now" when stamping state', async () => {
    const { repo, captured } = make();
    await repo.markIndexStateMany(['a'], 'INDEXED', {
      indexedAt: new Date(),
      indexError: null,
    });
    expect(captured.set).toBeDefined();
    expect(captured.set).toHaveProperty('updatedAt');
    // Assigned the column to itself rather than a Date — this is what suppresses
    // Drizzle's `$onUpdate`.
    expect(captured.set?.updatedAt).not.toBeInstanceOf(Date);
    expect(sqlText(captured.set?.updatedAt)).toContain('updated_at');
  });

  it('counts the attempt and records the handoff time', async () => {
    const { repo, captured } = make();
    await repo.markIndexStateMany(['a', 'b'], 'FAILED', {
      indexError: 'meili down',
    });
    expect(captured.set?.indexState).toBe('FAILED');
    expect(captured.set?.indexError).toBe('meili down');
    expect(captured.set?.indexAttemptedAt).toBeInstanceOf(Date);
    expect(sqlText(captured.set?.indexAttempts)).toContain('index_attempts');
  });

  it('leaves indexedAt untouched when the caller omits it', async () => {
    const { repo, captured } = make();
    await repo.markIndexStateMany(['a'], 'FAILED', { indexError: 'x' });
    expect(captured.set).not.toHaveProperty('indexedAt');
  });

  it('is a no-op for an empty id list', async () => {
    const { repo, captured } = make();
    await repo.markIndexStateMany([], 'INDEXED');
    expect(captured.set).toBeUndefined();
  });
});

describe('SearchRecordRepository delete paths', () => {
  // A soft-delete is a handoff, not a convergence: Meili is still serving the
  // document until the indexer removes it.
  it('soft-delete leaves the record PENDING with a fresh attempt budget', async () => {
    const { repo, captured } = make();
    await repo.softDelete('rec-1');
    expect(captured.set).toMatchObject({
      isDeleted: true,
      indexState: 'PENDING',
      indexAttempts: 0,
    });
    expect(captured.set?.deletedAt).toBeInstanceOf(Date);
    expect(captured.set?.indexAttemptedAt).toBeInstanceOf(Date);
  });

  it('collection purge leaves records PENDING, not falsely converged', async () => {
    const { repo, captured } = make();
    await repo.softDeleteByCollection('articles');
    expect(captured.set?.indexState).toBe('PENDING');
  });

  it('markCollectionPurged is the only path that claims convergence', async () => {
    const { repo, captured } = make();
    await repo.markCollectionPurged('articles');
    expect(captured.set?.indexState).toBe('INDEXED');
    expect(captured.set?.indexedAt).toBeInstanceOf(Date);
  });
});

describe('SearchRecordRepository sweep queries', () => {
  const BACKOFF = { staleMs: 300_000, maxBackoffMs: 3_600_000 };

  it('orders unsynced records oldest-attempt-first, NULLs before all', async () => {
    const { repo, captured } = make();
    await repo.findUnsynced(250, BACKOFF);
    expect(captured.limit).toBe(250);
    const order = sqlText(captured.orderBy);
    expect(order).toContain('index_attempted_at');
    expect(order).toContain('NULLS FIRST');
  });

  it('matches never-attempted rows as well as stale ones', async () => {
    const { repo, captured } = make();
    await repo.findUnsynced(10, BACKOFF);
    const where = sqlText(captured.where);
    // Without the IS NULL branch, a row whose handoff was never stamped can
    // never satisfy `index_attempted_at < cutoff` and would be swept never.
    expect(where).toContain('is null');
    expect(where).toContain('index_state');
  });

  // A record that can never succeed must not burn a retry every few minutes
  // forever — the wait doubles per attempt, capped, and it is never abandoned.
  it('backs off exponentially on the attempt count, capped', async () => {
    const { repo, captured } = make();
    await repo.findUnsynced(10, BACKOFF);
    const where = sqlText(captured.where);
    expect(where).toContain('power');
    expect(where).toContain('index_attempts');
    expect(where).toContain('least');
  });

  it('purge bounds the delete and returns the reclaimed count', async () => {
    const { repo } = make();
    await expect(repo.purgeSoftDeleted(new Date(), 500)).resolves.toBe(1);
  });

  it('skips the round-trip entirely for empty id lists', async () => {
    const { repo, captured } = make();
    expect(await repo.findByIds([])).toEqual([]);
    expect(await repo.findLiveByExternalIds('articles', [])).toEqual([]);
    expect(await repo.upsertMany([])).toEqual([]);
    expect(captured.values).toBeUndefined();
  });
});

describe('SearchRecordRepository upsert', () => {
  it('targets the partial unique index on (collection, externalId)', async () => {
    const { repo, captured } = make();
    await repo.upsertMany([
      { collection: 'articles', externalId: 'e1', checksum: 'c' } as never,
    ]);
    expect(captured.onConflict).toBeDefined();
    expect(sqlText(captured.onConflict?.targetWhere)).toContain('external_id');
    expect(sqlText(captured.onConflict?.targetWhere)).toContain('is_deleted');
  });

  it('takes the incoming content and resets the attempt budget on conflict', async () => {
    const { repo, captured } = make();
    await repo.upsertMany([
      { collection: 'articles', externalId: 'e1', checksum: 'c' } as never,
    ]);
    const set = captured.onConflict?.set as Record<string, unknown>;
    for (const field of [
      'document',
      'checksum',
      'indexState',
      'indexAttempts',
    ]) {
      expect(sqlText(set[field])).toContain('excluded');
    }
    // A content change *is* an update, so here updatedAt does move.
    expect(sqlText(set.updatedAt)).toContain('now()');
  });
});
