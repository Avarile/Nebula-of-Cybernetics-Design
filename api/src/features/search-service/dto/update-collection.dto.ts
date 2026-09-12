import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FieldSpec } from '../../../infrastructure/database/schema/search.schema';
import {
  VISIBILITIES,
  fieldSpecSchema,
  refineFields,
  refineVisibility,
} from './create-collection.dto';

export const updateCollectionSchema = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    description: z.string().max(500).nullable().optional(),
    fields: z.array(fieldSpecSchema).min(1).optional(),
    visibility: z.enum(VISIBILITIES).optional(),
    ownerField: z.string().min(1).max(100).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    refineFields(val.fields as FieldSpec[] | undefined, ctx);
    // Only checkable here when the request also carries the field spec;
    // otherwise CollectionService re-validates against the merged spec.
    refineVisibility(
      val.visibility,
      val.ownerField,
      val.fields as FieldSpec[] | undefined,
      ctx,
    );
  });

export class UpdateCollectionDto extends createZodDto(updateCollectionSchema) {}
