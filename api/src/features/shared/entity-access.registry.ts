import { Injectable, Logger } from '@nestjs/common';
import { isAdmin, type Principal } from '../../common/principal';

/** Answers "may this principal read this row?" for one entity type. */
export type EntityAccessCheck = (
  entityId: string,
  principal: Principal,
) => Promise<boolean>;

/**
 * Where feature modules declare how their entities are scoped.
 *
 * Comments and attachments are polymorphic: they hang off projects, tasks,
 * knowledge, contacts and invoices, and their readability is entirely the
 * parent's. Without this, the comment endpoint would either need to import
 * every feature module (a dependency cycle) or trust the caller's `entityType`
 * (a hole big enough to read any comment on any row).
 *
 * A module registers its resolver at bootstrap:
 *
 *   registry.register('project', (id, principal) =>
 *     this.projects.canRead(id, principal));
 *
 * **An unregistered entity type is denied**, not allowed. Until a module
 * registers, its comments are reachable by admins only — which is the correct
 * behaviour for a type nothing can yet vouch for, and means adding an entity
 * type to the enum cannot silently open it up.
 */
@Injectable()
export class EntityAccessRegistry {
  private readonly logger = new Logger(EntityAccessRegistry.name);
  private readonly checks = new Map<string, EntityAccessCheck>();

  register(entityType: string, check: EntityAccessCheck): void {
    if (this.checks.has(entityType)) {
      // A second registration means two modules claim one entity type; the
      // later would silently win. Refuse rather than pick.
      throw new Error(
        `Entity access check for "${entityType}" is already registered`,
      );
    }
    this.checks.set(entityType, check);
  }

  /** True when the principal may read the parent row. Fails closed. */
  async canRead(
    entityType: string,
    entityId: string,
    principal: Principal,
  ): Promise<boolean> {
    if (principal.kind === 'system' || isAdmin(principal)) return true;
    const check = this.checks.get(entityType);
    if (!check) {
      this.logger.debug(
        `No access check registered for "${entityType}" — denying`,
      );
      return false;
    }
    return check(entityId, principal);
  }

  /** Entity types with a registered resolver. Used by the readiness probe. */
  registeredTypes(): string[] {
    return [...this.checks.keys()].sort();
  }
}
