import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A batch of records to persist. `externalId` enables idempotent upsert. */
export const persistRecordsSchema = z.object({
  records: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255).optional(),
        document: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(1000),
});

export class PersistRecordsDto extends createZodDto(persistRecordsSchema) {}

/**
 * Query options for a persist call. Indexing is asynchronous by default (202 +
 * `PENDING`); `wait=true` polls until every written record settles, bounded by
 * `SEARCH_WAIT_TIMEOUT_MS`, for importers and tests that query immediately
 * afterwards. It is a bounded poll, not a synchronous write path.
 */
export const persistOptionsSchema = z.object({
  wait: z
    .preprocess((v) => v === true || v === 'true' || v === '1', z.boolean())
    .default(false),
});

export class PersistOptionsDto extends createZodDto(persistOptionsSchema) {}
