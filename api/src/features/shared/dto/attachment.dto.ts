import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ATTACHABLE_TYPES = [
  'project',
  'task',
  'knowledge',
  'contact',
  'contact_company',
  'invoice',
  'transaction',
] as const;

export const ATTACHMENT_KINDS = [
  'document',
  'image',
  'receipt',
  'contract',
  'other',
] as const;

export const attachFileSchema = z.object({
  entityType: z.enum(ATTACHABLE_TYPES),
  entityId: z.string().uuid(),
  /** An existing `files` row — upload happens through the file endpoints. */
  fileId: z.string().uuid(),
  label: z.string().max(255).optional(),
  kind: z.enum(ATTACHMENT_KINDS).default('document'),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export class AttachFileDto extends createZodDto(attachFileSchema) {}

export const listAttachmentsSchema = z.object({
  entityType: z.enum(ATTACHABLE_TYPES),
  entityId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListAttachmentsDto extends createZodDto(listAttachmentsSchema) {}
