/**
 * Drizzle schema barrel.
 *
 * Re-export every table module here so the typed `db`
 * (`NodePgDatabase<typeof schema>`) and drizzle-kit both see the full schema.
 * Use `baseColumns` from `./common` for the shared id + timestamp columns.
 *
 * Example:
 *   export * from './user.schema';
 */
export * from './file.schema';
export * from './identity.schema';
export * from './system.schema';
export * from './search.schema';
export * from './agent.schema';
export * from './password-reset.schema';
export * from './mailbox.schema';
export * from './shared.schema';
export * from './rbac.schema';
export * from './profile.schema';
export * from './project.schema';
export * from './contact.schema';
export * from './knowledge.schema';
export * from './finance.schema';
export * from './project-link.schema';
export * from './notification.schema';
export * from './calendar.schema';
