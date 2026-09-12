import { inArray } from 'drizzle-orm';
import type { DrizzleDB } from '../drizzle.constants';
import { permissions, rolePermissions, roles } from '../schema/rbac.schema';
import type { Seeder } from './seeder.interface';
import { insertMissingByKey } from './seed.util';

/** `<resource>.<action>` catalog. Every `@RequirePermission` must name one. */
const PERMISSIONS: Array<[key: string, description: string]> = [
  ['project.read', 'View projects the caller is scoped to'],
  ['project.create', 'Create a project'],
  ['project.update', 'Edit project fields'],
  ['project.delete', 'Soft-delete a project'],
  ['project.manage_members', 'Add or remove project members'],
  ['project.task.read', 'View tasks within a readable project'],
  ['project.task.create', 'Create tasks'],
  ['project.task.update', 'Edit tasks, including status and assignee'],
  ['project.task.delete', 'Soft-delete tasks'],
  ['project.time.log', 'Log time against a task or project'],
  ['project.time.approve', 'Approve logged time for billing'],
  ['knowledge.read', 'Read knowledge the caller has been granted'],
  ['knowledge.create', 'Create knowledge records'],
  ['knowledge.update', 'Edit knowledge records'],
  ['knowledge.delete', 'Soft-delete knowledge records'],
  ['knowledge.publish', 'Move a record from review to published'],
  ['knowledge.manage_access', 'Grant or revoke knowledge access'],
  ['contact.read', 'View contacts in scope'],
  ['contact.create', 'Create contacts and companies'],
  ['contact.update', 'Edit contacts and companies'],
  ['contact.delete', 'Soft-delete contacts'],
  ['contact.export', 'Export contact data in bulk'],
  ['finance.read', 'View financial records'],
  ['finance.transaction.create', 'Record income and expenses'],
  ['finance.transaction.update', 'Amend unsettled transactions'],
  ['finance.invoice.manage', 'Issue, send and void invoices'],
  ['finance.budget.manage', 'Create and adjust budgets'],
  ['finance.fx.manage', 'Record exchange rates into the historical archive'],
  ['calendar.read', 'View your calendar events and occurrences'],
  ['calendar.write', 'Create, edit, move and cancel calendar events'],
  ['notification.manage', 'Edit notification templates and event types'],
  ['system.settings.manage', 'Edit system settings and integrations'],
  ['system.audit.read', 'Read audit and event logs'],
  ['system.flags.manage', 'Toggle feature flags'],
  ['user.read', 'List and view user accounts'],
  ['user.manage', 'Create, edit and deactivate users'],
  ['rbac.manage', 'Grant roles and permissions'],
];

/**
 * Roles seeded here. `user`, `admin` and `agent` mirror the `user_role` enum so
 * the coarse JWT vocabulary and this table cannot drift; the rest are curated
 * bundles.
 *
 * `admin` intentionally receives NO grants: `isAdmin(principal)` short-circuits
 * before any permission lookup. Seeding it with every permission would imply
 * that removing one restricts an admin, which is false.
 */
const ROLES: Array<{
  key: string;
  name: string;
  description: string;
  priority: number;
  grants: string[];
}> = [
  {
    key: 'admin',
    name: 'Administrator',
    description:
      'Full access. Bypasses permission checks — grants here are not consulted.',
    priority: 100,
    grants: [],
  },
  {
    key: 'user',
    name: 'Standard User',
    description: 'Baseline capabilities every human account receives.',
    priority: 50,
    grants: [
      'project.read',
      'project.task.read',
      'project.task.create',
      'project.task.update',
      'project.time.log',
      'knowledge.read',
      'knowledge.create',
      'knowledge.update',
      'contact.read',
      'contact.create',
      'contact.update',
      'calendar.read',
      'calendar.write',
    ],
  },
  {
    key: 'agent',
    name: 'Agent',
    description:
      'Machine callers. Read-oriented; writes go through tools that carry an explicit principal.',
    priority: 10,
    grants: [
      'project.read',
      'project.task.read',
      'knowledge.read',
      'contact.read',
      'calendar.read',
    ],
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    description: 'Runs projects: membership, planning and time approval.',
    priority: 70,
    grants: [
      'project.read',
      'project.create',
      'project.update',
      'project.delete',
      'project.manage_members',
      'project.task.read',
      'project.task.create',
      'project.task.update',
      'project.task.delete',
      'project.time.log',
      'project.time.approve',
      'contact.read',
      'knowledge.read',
    ],
  },
  {
    key: 'knowledge_editor',
    name: 'Knowledge Editor',
    description: 'Curates the knowledge base and its access grants.',
    priority: 60,
    grants: [
      'knowledge.read',
      'knowledge.create',
      'knowledge.update',
      'knowledge.delete',
      'knowledge.publish',
      'knowledge.manage_access',
      'contact.read',
    ],
  },
  {
    key: 'finance_manager',
    name: 'Finance Manager',
    description: 'Owns income, spending, budgets and invoicing.',
    priority: 65,
    grants: [
      'finance.read',
      'finance.transaction.create',
      'finance.transaction.update',
      'finance.invoice.manage',
      'finance.budget.manage',
      'finance.fx.manage',
      'project.read',
      'contact.read',
      'project.time.approve',
    ],
  },
  {
    key: 'finance_viewer',
    name: 'Finance Viewer',
    description: 'Read-only access to financial reporting.',
    priority: 40,
    grants: ['finance.read', 'project.read'],
  },
];

/**
 * Seeds the permission catalog, the roles, and the grants between them.
 *
 * Grants are only ADDED, never removed: a deployment must not silently strip a
 * permission an administrator granted deliberately. Removing a seeded grant is
 * an explicit migration.
 */
export class RbacSeeder implements Seeder {
  readonly name = 'rbac';

  async run(db: DrizzleDB): Promise<void> {
    const permissionCount = await insertMissingByKey(
      db,
      permissions,
      permissions.key,
      PERMISSIONS.map(([key, description]) => {
        const segments = key.split('.');
        return {
          key,
          resource: segments[0],
          action: segments[segments.length - 1],
          description,
          isSystem: true,
        };
      }),
      (r) => r.key,
    );

    const roleCount = await insertMissingByKey(
      db,
      roles,
      roles.key,
      ROLES.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        priority: r.priority,
        isSystem: true,
      })),
      (r) => r.key,
    );

    const permissionRows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions);
    const permissionIdByKey = new Map(
      permissionRows.map((p) => [p.key, p.id] as const),
    );

    const roleRows = await db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(
        inArray(
          roles.key,
          ROLES.map((r) => r.key),
        ),
      );
    const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id] as const));

    const existingGrants = await db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
      })
      .from(rolePermissions);
    const held = new Set(
      existingGrants.map((g) => `${g.roleId}:${g.permissionId}`),
    );

    const newGrants: Array<{ roleId: string; permissionId: string }> = [];
    for (const role of ROLES) {
      const roleId = roleIdByKey.get(role.key);
      if (!roleId) continue;
      for (const permissionKey of role.grants) {
        const permissionId = permissionIdByKey.get(permissionKey);
        if (!permissionId) {
          throw new Error(
            `Role "${role.key}" grants unknown permission "${permissionKey}"`,
          );
        }
        if (held.has(`${roleId}:${permissionId}`)) continue;
        newGrants.push({ roleId, permissionId });
      }
    }
    if (newGrants.length > 0) {
      await db.insert(rolePermissions).values(newGrants);
    }

    console.log(
      `  ↳ permissions +${permissionCount}, roles +${roleCount}, grants +${newGrants.length}`,
    );
  }
}
