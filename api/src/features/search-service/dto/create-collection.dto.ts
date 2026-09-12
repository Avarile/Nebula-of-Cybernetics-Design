import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type {
  CollectionVisibility,
  FieldSpec,
} from '../../../infrastructure/database/schema/search.schema';
import { validateFieldSpec, validateVisibility } from '../document-validator';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'string[]',
  'number[]',
] as const;

/** One field-spec entry. Structural cross-field rules run in `validateFieldSpec`. */
export const fieldSpecSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
});

/** Attach `validateFieldSpec` errors as Zod issues on a `fields` array. */
export function refineFields(
  fields: FieldSpec[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!fields) return;
  for (const message of validateFieldSpec(fields)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['fields'] });
  }
}

/**
 * Attach `validateVisibility` errors as Zod issues on `ownerField`.
 *
 * Skipped when `fields` is absent, which on the PATCH path means "not changing
 * the field spec" — `CollectionService` re-runs the same check against the
 * merged spec, where the real answer is known.
 */
export function refineVisibility(
  visibility: CollectionVisibility | undefined,
  ownerField: string | null | undefined,
  fields: FieldSpec[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!visibility || !fields) return;
  for (const message of validateVisibility(visibility, ownerField, fields)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: ['ownerField'],
    });
  }
}

export const VISIBILITIES = ['private', 'owner_scoped', 'shared'] as const;

export const createCollectionSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'name must be lower_snake_case')
      .max(100),
    displayName: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    fields: z.array(fieldSpecSchema).min(1),
    /**
     * Read policy. Defaults to the most restrictive value: a collection whose
     * creator did not think about visibility is admin-only, never world-readable.
     */
    visibility: z.enum(VISIBILITIES).default('private'),
    /** Required for (and only for) `owner_scoped`. See `validateVisibility`. */
    ownerField: z.string().min(1).max(100).optional(),
  })
  .superRefine((val, ctx) => {
    refineFields(val.fields as FieldSpec[], ctx);
    refineVisibility(
      val.visibility,
      val.ownerField,
      val.fields as FieldSpec[],
      ctx,
    );
  });

export class CreateCollectionDto extends createZodDto(createCollectionSchema) {}
