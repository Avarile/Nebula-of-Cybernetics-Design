import type { ProjectRow } from '../../infrastructure/database/schema/project.schema';
import type { ProjectAccess } from './project-scope.resolver';

/** A project as the API returns it — never the raw row. */
export interface PublicProject {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectRow['status'];
  priority: ProjectRow['priority'];
  visibility: ProjectRow['visibility'];
  ownerUserId: string | null;
  leadUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  progressPct: number;
  tagIds: string[];
  /** What the asking principal may do, so a client need not guess. */
  access: ProjectAccess;
  updatedAt: Date;
}

/**
 * Project row → wire shape.
 *
 * Explicit field-by-field rather than a spread: `projects` carries columns the
 * API has no business returning (`taskSeq`, `metadata`, the soft-delete pair),
 * and a spread would leak each new one automatically.
 */
export function toPublicProject(
  row: ProjectRow,
  access: ProjectAccess,
  tagIds: string[] = [],
): PublicProject {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority,
    visibility: row.visibility,
    ownerUserId: row.ownerUserId ?? null,
    leadUserId: row.leadUserId ?? null,
    startDate: row.startDate ?? null,
    dueDate: row.dueDate ?? null,
    progressPct: row.progressPct,
    tagIds,
    access,
    updatedAt: row.updatedAt,
  };
}

/**
 * A `date` column takes `YYYY-MM-DD`, and the DTOs coerce to `Date`.
 *
 * `undefined` passes through untouched so a patch that omits the field leaves
 * it alone — Drizzle drops `undefined` from `.set()`, while `null` clears it.
 */
export function toDateString(
  d: Date | null | undefined,
): string | null | undefined {
  if (d === undefined) return undefined;
  return d === null ? null : d.toISOString().slice(0, 10);
}
