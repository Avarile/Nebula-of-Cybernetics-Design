import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSchemaIsCurrent } from './schema-version.guard';

/** A migrations directory containing `count` .sql files (plus noise). */
function migrationsWith(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `000${i}_x.sql`), '-- migration');
  }
  // drizzle also writes a meta/ directory; only .sql files should be counted.
  writeFileSync(join(dir, 'notes.md'), 'not a migration');
  return dir;
}

const poolWith = (applied: number | Error) => ({
  query: jest.fn(async () => {
    if (applied instanceof Error) throw applied;
    return { rows: [{ count: String(applied) }] };
  }),
});

describe('assertSchemaIsCurrent', () => {
  it('passes when the applied count matches the files on disk', async () => {
    await expect(
      assertSchemaIsCurrent(poolWith(3) as never, migrationsWith(3)),
    ).resolves.toBeUndefined();
  });

  // The failure this exists for: a replica on an old schema used to boot fine
  // and then fail at the first query, one confusing error per endpoint.
  it('refuses to start when migrations are outstanding', async () => {
    await expect(
      assertSchemaIsCurrent(poolWith(1) as never, migrationsWith(3)),
    ).rejects.toThrow(/schema is behind: 1 migration\(s\) applied, 3 on disk/);
  });

  it('refuses to start when the journal table does not exist', async () => {
    await expect(
      assertSchemaIsCurrent(
        poolWith(new Error('relation does not exist')) as never,
        migrationsWith(2),
      ),
    ).rejects.toThrow(/no migration journal/);
  });

  // Being ahead is usually a rollback or an older replica; the newer schema is
  // typically a superset, so warn rather than refuse to serve.
  it('warns but starts when the database is ahead of the build', async () => {
    await expect(
      assertSchemaIsCurrent(poolWith(5) as never, migrationsWith(3)),
    ).resolves.toBeUndefined();
  });

  it('counts only .sql files', async () => {
    await expect(
      assertSchemaIsCurrent(poolWith(2) as never, migrationsWith(2)),
    ).resolves.toBeUndefined();
  });
});
