import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** External search request. `filters`/`sort` are structured, never raw Meili. */
export const searchQuerySchema = z.object({
  q: z.string().default(''),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().optional(),
  filters: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number()])),
      ]),
    )
    .optional(),
  sort: z.array(z.string()).optional(),
  facets: z.array(z.string()).optional(),
  highlight: z.array(z.string()).optional(),
});

export class SearchQueryDto extends createZodDto(searchQuerySchema) {}
