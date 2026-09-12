import { createHash } from 'node:crypto';
import type { SearchRecordRow } from '../../infrastructure/database/schema/search.schema';

/** Shared BullMQ options for indexing jobs: bounded retries, self-cleaning. */
export const INDEXING_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

/** sha256 over a canonical (key-sorted) serialization — order-independent. */
export function computeChecksum(
  externalId: string | null,
  document: Record<string, unknown>,
): string {
  const canonical = stableStringify({
    externalId: externalId ?? null,
    document,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Build the Meili document from a record row (system fields + payload). */
export function toMeiliDocument(row: SearchRecordRow): Record<string, unknown> {
  return {
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...row.document,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Split a list into fixed-size chunks (one batched index job per chunk). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Deterministic JSON with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
    );
  return `{${entries.join(',')}}`;
}
