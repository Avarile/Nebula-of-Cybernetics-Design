import { KnowledgeRepository } from './knowledge.repository';
import { knowledge } from '../../infrastructure/database/schema/knowledge.schema';

/** Minimal chainable Drizzle mock that captures what `.set()` was given. */
function makeDb() {
  const state: any = { lastSet: null };
  const db: any = {
    update: jest.fn(() => ({
      set: jest.fn((patch: any) => {
        state.lastSet = patch;
        return { where: jest.fn(async () => undefined) };
      }),
    })),
  };
  return { db, state };
}

describe('KnowledgeRepository.bumpViewCount', () => {
  it('pins updatedAt so a read does not restamp the record', async () => {
    // `baseColumns.updatedAt` has `$onUpdate`, which Drizzle applies to any
    // column absent from `.set()`. Because `KnowledgeService.get` calls this on
    // every read, omitting the column made a plain GET move the modification
    // time — and `list()` orders by `desc(updatedAt)`, so opening a record
    // floated it to the top of the listing as though it had been edited.
    const { db, state } = makeDb();
    await new KnowledgeRepository(db).bumpViewCount('k1');

    expect(state.lastSet).toHaveProperty('updatedAt');
    // Self-assignment — a no-op write, which is what suppresses `$onUpdate`.
    // The value is an SQL fragment wrapping the column, so assert on what it
    // references rather than on identity.
    expect(state.lastSet.updatedAt.queryChunks).toContain(knowledge.updatedAt);
  });

  it('still increments the counter', async () => {
    const { db, state } = makeDb();
    await new KnowledgeRepository(db).bumpViewCount('k1');
    expect(state.lastSet).toHaveProperty('viewCount');
  });
});
