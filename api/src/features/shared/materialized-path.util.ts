/**
 * Materialized-path helpers for the category trees (contacts, knowledge,
 * finance).
 *
 * `path` is `/root/child/leaf`, so a subtree read is an index range scan
 * (`path LIKE '/root/%'`) rather than a recursive CTE per query. The cost is a
 * subtree rewrite when a node moves, which these helpers keep correct and
 * bounded.
 *
 * Pure functions: the three services differ only in which table they write, and
 * the tree arithmetic should not be re-derived (or re-mis-derived) three times.
 */

/** Path of a child of `parentPath` (null parent = root). */
export function childPath(parentPath: string | null, key: string): string {
  return `${parentPath ?? ''}/${key}`;
}

/**
 * Whether moving `nodePath` under `parentPath` would detach the tree.
 *
 * A prospective parent whose path lies inside the moving node's subtree is a
 * descendant of it, so the move would orphan everything between them. Comparing
 * paths answers that with one string test instead of a recursive walk — which
 * is the second reason the path is worth maintaining.
 */
export function wouldCycle(nodePath: string, parentPath: string): boolean {
  return `${parentPath}/`.startsWith(`${nodePath}/`);
}

/** Re-root a descendant's path when its ancestor moves. */
export function rewritePath(
  rowPath: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  return rowPath.startsWith(oldPrefix)
    ? `${newPrefix}${rowPath.slice(oldPrefix.length)}`
    : rowPath;
}

/** Depth of a descendant after its ancestor moves to `newDepth`. */
export function rewriteDepth(
  rowDepth: number,
  oldRootDepth: number,
  newRootDepth: number,
): number {
  return rowDepth - oldRootDepth + newRootDepth;
}
