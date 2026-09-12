import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Optional completion payload — a client may confirm the SHA-256 it uploaded. */
export const completeUploadSchema = z.object({
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'must be a 64-character hex SHA-256')
    .optional(),
});

export class CompleteUploadDto extends createZodDto(completeUploadSchema) {}
