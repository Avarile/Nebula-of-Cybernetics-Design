import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CONTACT_STATUSES } from './contact.dto';

export const COMPANY_SIZES = [
  'micro',
  'small',
  'medium',
  'large',
  'enterprise',
] as const;

export const createCompanySchema = z.object({
  name: z.string().min(1).max(255),
  legalName: z.string().max(255).optional(),
  /** Lowercased by the service; the natural key for email-domain matching. */
  domain: z.string().max(255).optional(),
  industry: z.string().max(120).optional(),
  size: z.enum(COMPANY_SIZES).optional(),
  website: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  country: z.string().length(2).optional(),
  parentCompanyId: z.string().uuid().optional(),
  status: z.enum(CONTACT_STATUSES).default('active'),
  description: z.string().max(20_000).optional(),
  taxNumber: z.string().max(60).optional(),
});

export class CreateCompanyDto extends createZodDto(createCompanySchema) {}

export const updateCompanySchema = createCompanySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}

export const listCompaniesSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListCompaniesDto extends createZodDto(listCompaniesSchema) {}
