import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const KNOWLEDGE_FORMATS = [
  'markdown',
  'html',
  'plain',
  'link',
  'file',
] as const;
export const KNOWLEDGE_STATUSES = [
  'draft',
  'in_review',
  'published',
  'archived',
  'deprecated',
] as const;
export const KNOWLEDGE_VISIBILITIES = [
  'private',
  'restricted',
  'internal',
] as const;
export const KNOWLEDGE_PERMISSIONS = [
  'read',
  'comment',
  'write',
  'manage',
] as const;
export const GRANTEE_TYPES = ['user', 'role', 'authenticated'] as const;
export const KNOWLEDGE_CONTACT_RELATIONS = [
  'subject',
  'author',
  'source',
  'expert',
  'mentioned',
] as const;

export const createKnowledgeSchema = z.object({
  title: z.string().min(1).max(500),
  /** Derived from the title when omitted; collisions get a numeric suffix. */
  slug: z
    .string()
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase-with-dashes')
    .optional(),
  summary: z.string().max(1000).optional(),
  body: z.string().max(2_000_000).optional(),
  format: z.enum(KNOWLEDGE_FORMATS).default('markdown'),
  typeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  /** Defaults to the restrictive value, as `collections.visibility` does. */
  visibility: z.enum(KNOWLEDGE_VISIBILITIES).default('private'),
  sourceUrl: z.string().max(2000).optional(),
  sourceFileId: z.string().uuid().optional(),
  language: z.string().max(16).default('en'),
  reviewDueAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export class CreateKnowledgeDto extends createZodDto(createKnowledgeSchema) {}

export const updateKnowledgeSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    summary: z.string().max(1000).nullable().optional(),
    body: z.string().max(2_000_000).nullable().optional(),
    format: z.enum(KNOWLEDGE_FORMATS).optional(),
    typeId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    visibility: z.enum(KNOWLEDGE_VISIBILITIES).optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    sourceUrl: z.string().max(2000).nullable().optional(),
    language: z.string().max(16).optional(),
    reviewDueAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(50).optional(),
    /** Optimistic concurrency; omit for last-write-wins. */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateKnowledgeDto extends createZodDto(updateKnowledgeSchema) {}

export const listKnowledgeSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(KNOWLEDGE_STATUSES).optional(),
  typeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListKnowledgeDto extends createZodDto(listKnowledgeSchema) {}

export const transitionSchema = z.object({
  status: z.enum(KNOWLEDGE_STATUSES),
  note: z.string().max(500).optional(),
});

export class TransitionKnowledgeDto extends createZodDto(transitionSchema) {}

export const createGrantSchema = z
  .object({
    granteeType: z.enum(GRANTEE_TYPES),
    granteeUserId: z.string().uuid().optional(),
    granteeRoleId: z.string().uuid().optional(),
    permission: z.enum(KNOWLEDGE_PERMISSIONS).default('read'),
    expiresAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    // Mirrors the CHECK constraint: exactly one grantee per row. Caught here so
    // the caller gets a field error rather than a database constraint failure.
    const expected = {
      user: v.granteeUserId && !v.granteeRoleId,
      role: v.granteeRoleId && !v.granteeUserId,
      authenticated: !v.granteeUserId && !v.granteeRoleId,
    }[v.granteeType];
    if (!expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['granteeType'],
        message: `granteeType "${v.granteeType}" requires exactly its own grantee id`,
      });
    }
  });

export class CreateGrantDto extends createZodDto(createGrantSchema) {}

export const linkContactSchema = z.object({
  contactId: z.string().uuid(),
  relation: z.enum(KNOWLEDGE_CONTACT_RELATIONS).default('subject'),
  note: z.string().max(500).optional(),
});

export class LinkContactDto extends createZodDto(linkContactSchema) {}
