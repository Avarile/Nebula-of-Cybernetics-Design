import { sql, type SQL } from 'drizzle-orm';
import {
  projectMembers,
  projects,
} from '../../infrastructure/database/schema/project.schema';

/**
 * The rows a user may see, as SQL.
 *
 * Own it, be a member of it, or it is `internal` — the same three clauses
 * `resolveProjectAccess` applies in memory, expressed once so the project list
 * and the cross-project task list cannot drift apart on who can see what.
 */
export function projectVisibleTo(userId: string): SQL {
  return sql`(
    ${projects.ownerUserId} = ${userId}
    OR ${projects.visibility} = 'internal'
    OR EXISTS (
      SELECT 1 FROM ${projectMembers}
      WHERE ${projectMembers.projectId} = ${projects.id}
        AND ${projectMembers.userId} = ${userId}
        AND ${projectMembers.isDeleted} = false
    )
  )`;
}

/**
 * Restrict a query on another table to tasks whose project is live and, when
 * `userId` is given, readable by that user.
 *
 * This replaces materializing the caller's project ids in the service and
 * passing them down as an `IN` list. That read one page of 500 ordered by
 * `updated_at` with no continuation, so a user past 500 visible projects
 * silently lost tasks — and since `internal` projects are visible to everyone,
 * 500 is an installation-wide count, not a per-user one.
 *
 * The liveness clause is unconditional, including for admins: a task whose
 * project has been deleted must never appear in a listing, whatever the caller
 * holds. That is belt-and-braces against the delete cascade missing a row.
 */
export function taskProjectVisible(
  projectIdColumn: SQL | unknown,
  userId?: string,
): SQL {
  const readable = userId ? sql` AND ${projectVisibleTo(userId)}` : sql``;
  return sql`EXISTS (
    SELECT 1 FROM ${projects}
    WHERE ${projects.id} = ${projectIdColumn}
      AND ${projects.isDeleted} = false${readable}
  )`;
}
