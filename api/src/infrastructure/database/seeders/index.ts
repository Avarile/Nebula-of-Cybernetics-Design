import { InitialAdminSeeder } from './initial-admin.seeder';
import { NotificationCatalogSeeder } from './notification-catalog.seeder';
import { RbacSeeder } from './rbac.seeder';
import { ReferenceDataSeeder } from './reference-data.seeder';
import { SystemPolicySeeder } from './system-policy.seeder';
import type { Seeder } from './seeder.interface';

/**
 * Ordered list of seeders run by `pnpm seed`. Order matters: reference data and
 * the permission catalog must exist before anything that grants or references
 * them. Every seeder is idempotent and only ever inserts what is missing.
 */
export const seeders: Seeder[] = [
  new InitialAdminSeeder(),
  new ReferenceDataSeeder(),
  new RbacSeeder(),
  new NotificationCatalogSeeder(),
  new SystemPolicySeeder(),
];
