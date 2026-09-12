import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CONTACT_STATUSES = [
  'active',
  'inactive',
  'archived',
  'do_not_contact',
] as const;
export const CONTACT_SOURCES = [
  'manual',
  'inbound_email',
  'import',
  'referral',
  'website',
  'agent',
] as const;
export const CONTACT_VISIBILITIES = ['private', 'shared'] as const;
export const CHANNEL_KINDS = [
  'email',
  'phone',
  'mobile',
  'fax',
  'website',
  'linkedin',
  'twitter',
  'wechat',
  'whatsapp',
  'other',
] as const;

const addressSchema = z
  .object({
    line1: z.string().max(255).optional(),
    line2: z.string().max(255).optional(),
    city: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    postalCode: z.string().max(30).optional(),
    country: z.string().max(120).optional(),
  })
  .optional();

export const createContactSchema = z
  .object({
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
    /** Derived from the name parts when omitted — never left empty. */
    displayName: z.string().max(255).optional(),
    salutation: z.string().max(40).optional(),
    primaryEmail: z.string().email().max(320).optional(),
    primaryPhone: z.string().max(40).optional(),
    jobTitle: z.string().max(150).optional(),
    companyId: z.string().uuid().optional(),
    typeId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    status: z.enum(CONTACT_STATUSES).default('active'),
    source: z.enum(CONTACT_SOURCES).default('manual'),
    /** Defaults to the restrictive value; sharing is an explicit act. */
    visibility: z.enum(CONTACT_VISIBILITIES).default('private'),
    address: addressSchema,
    country: z.string().length(2).optional(),
    timezone: z.string().max(64).optional(),
    language: z.string().max(16).optional(),
    birthday: z.coerce.date().optional(),
    notes: z.string().max(20_000).optional(),
    nextFollowUpAt: z.coerce.date().optional(),
    tagIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((v) => v.displayName || v.firstName || v.lastName || v.primaryEmail, {
    message: 'Provide a name or an email address',
  });

export class CreateContactDto extends createZodDto(createContactSchema) {}

export const updateContactSchema = z
  .object({
    firstName: z.string().max(120).nullable().optional(),
    lastName: z.string().max(120).nullable().optional(),
    displayName: z.string().min(1).max(255).optional(),
    salutation: z.string().max(40).nullable().optional(),
    primaryEmail: z.string().email().max(320).nullable().optional(),
    primaryPhone: z.string().max(40).nullable().optional(),
    jobTitle: z.string().max(150).nullable().optional(),
    companyId: z.string().uuid().nullable().optional(),
    typeId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    status: z.enum(CONTACT_STATUSES).optional(),
    visibility: z.enum(CONTACT_VISIBILITIES).optional(),
    address: addressSchema,
    country: z.string().length(2).nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    language: z.string().max(16).nullable().optional(),
    birthday: z.coerce.date().nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
    nextFollowUpAt: z.coerce.date().nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateContactDto extends createZodDto(updateContactSchema) {}

export const listContactsSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  typeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListContactsDto extends createZodDto(listContactsSchema) {}

export const addChannelSchema = z.object({
  kind: z.enum(CHANNEL_KINDS),
  value: z.string().min(1).max(320),
  label: z.string().max(60).optional(),
  isPrimary: z.boolean().default(false),
});

export class AddChannelDto extends createZodDto(addChannelSchema) {}
