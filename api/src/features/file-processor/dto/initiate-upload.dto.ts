import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Declared metadata for a new upload (validated before any URL is issued). */
export const initiateUploadSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().positive(),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'must be a 64-character hex SHA-256')
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class InitiateUploadDto extends createZodDto(initiateUploadSchema) {}
