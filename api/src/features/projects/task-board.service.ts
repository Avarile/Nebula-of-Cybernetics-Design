import { Injectable, Logger } from '@nestjs/common';
import { ExceptionService } from '../../infrastructure/exceptions';
import type { TaskRow } from '../../infrastructure/database/schema/project.schema';
import {
  evenlySpacedRanks,
  initialRank,
  needsRebalance,
  rankBetween,
} from './lexorank.util';
import { TaskRepository } from './task.repository';

/**
 * Where a card sits in a board column.
 *
 * Split out of `TaskService` because ordering is a different concern from a
 * task's lifecycle, and the two were sharing a method that had grown to do
 * both. `TaskService.move` still owns the status transition — it routes that
 * through the same guards `update` uses — and asks this for the rank alone.
 */
@Injectable()
export class TaskBoardService {
  private readonly logger = new Logger(TaskBoardService.name);

  constructor(
    private readonly repo: TaskRepository,
    private readonly errors: ExceptionService,
  ) {}

  /**
   * The rank a task should take in `status`, placed after `afterTaskId`.
   *
   * Writes nothing. The rank is computed strictly between its new neighbours,
   * which is the whole reason ranks are strings: an integer `sort_order` would
   * renumber every row below the insertion point on every drag.
   */
  async rankFor(
    task: TaskRow,
    status: TaskRow['status'],
    afterTaskId?: string | null,
  ): Promise<string> {
    const ranks = (await this.repo.ranksAround(task.projectId, status)).filter(
      (r) => r !== task.sortRank,
    );

    if (!afterTaskId) {
      return ranks.length > 0 ? rankBetween(null, ranks[0]) : initialRank();
    }

    const anchor = await this.repo.findLiveById(afterTaskId);
    // The anchor must be in the column being moved INTO. `ranks` comes from the
    // target column while the anchor's rank comes from wherever it sits, so an
    // anchor from another column makes the two incomparable and the card lands
    // somewhere arbitrary — previously with a 2xx, so the client never learned
    // the drop had missed.
    if (
      !anchor ||
      anchor.projectId !== task.projectId ||
      anchor.status !== status ||
      !anchor.sortRank
    ) {
      throw this.errors.validation([
        { path: 'afterTaskId', message: 'Anchor task is not on this board' },
      ]);
    }

    const following = ranks.find((r) => r > anchor.sortRank!) ?? null;
    return rankBetween(anchor.sortRank, following);
  }

  /**
   * Rewrite a column with fresh short ranks when they have grown too long.
   *
   * `rankBetween` extends the string by a character whenever two neighbours are
   * adjacent — deliberately, and the docstring has always said so: "which is
   * why ranks grow slowly over time and why `needsRebalance` exists."
   * `needsRebalance` did exist. Nothing called it, and nothing called
   * `evenlySpacedRanks` either, so ranks grew monotonically against a
   * `varchar(64)` column that errors rather than truncates. Measured at about
   * one character per five "move to top" gestures, a busy column starts
   * rejecting drags after a few hundred.
   *
   * Called after a move, and a no-op until the threshold is crossed, so the
   * cost falls on the one drag that trips it rather than on a sweep.
   */
  async rebalanceIfNeeded(
    projectId: string,
    status: TaskRow['status'],
  ): Promise<number> {
    const ordered = await this.repo.orderedForColumn(projectId, status);
    if (!needsRebalance(ordered.map((t) => t.sortRank ?? ''))) return 0;

    const fresh = evenlySpacedRanks(ordered.length);
    await this.repo.setRanks(
      ordered.map((task, i) => ({ id: task.id, sortRank: fresh[i] })),
    );
    this.logger.log(
      `Rebalanced ${ordered.length} rank(s) in ${projectId}/${status}`,
    );
    return ordered.length;
  }
}
