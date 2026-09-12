import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { TaskBoardService } from './task-board.service';

/**
 * Board placement.
 *
 * The regression: the anchor was checked for belonging to the same project and
 * for having a rank, but not for being in the column the card was moving INTO.
 * `ranksAround` reads the TARGET column while the anchor's rank came from
 * wherever it happened to sit, so the two were incomparable and the computed
 * rank put the card somewhere arbitrary — and the call returned 2xx, so the
 * client never learned the drop had missed.
 */
describe('TaskBoardService.rankFor', () => {
  const task = {
    id: 't1',
    projectId: 'p1',
    status: 'todo',
    sortRank: 'i',
  } as never;

  function boardWith(
    ranks: string[],
    anchor: Record<string, unknown> | null = null,
  ) {
    const repo = {
      ranksAround: jest.fn(async () => ranks),
      findLiveById: jest.fn(async () => anchor),
    };
    return new TaskBoardService(repo as never, new ExceptionService());
  }

  it('seeds the first rank in an empty column', async () => {
    const board = boardWith([]);
    await expect(board.rankFor(task, 'in_progress')).resolves.toBe('i');
  });

  it('places an unanchored move above the current top', async () => {
    const board = boardWith(['i', 'r']);
    const rank = await board.rankFor(task, 'in_progress');
    expect(rank < 'i').toBe(true);
  });

  it('places an anchored move strictly between its neighbours', async () => {
    const board = boardWith(['i', 'r'], {
      id: 'anchor',
      projectId: 'p1',
      status: 'in_progress',
      sortRank: 'i',
    });
    const rank = await board.rankFor(task, 'in_progress', 'anchor');
    expect(rank > 'i' && rank < 'r').toBe(true);
  });

  it('refuses an anchor sitting in a different column', async () => {
    const board = boardWith(['i', 'r'], {
      id: 'anchor',
      projectId: 'p1',
      status: 'backlog', // not the column being moved into
      sortRank: 'z',
    });
    await expect(
      board.rankFor(task, 'in_progress', 'anchor'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('refuses an anchor in a different project', async () => {
    const board = boardWith(['i'], {
      id: 'anchor',
      projectId: 'p2',
      status: 'in_progress',
      sortRank: 'i',
    });
    await expect(
      board.rankFor(task, 'in_progress', 'anchor'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('refuses an anchor that does not exist', async () => {
    const board = boardWith(['i'], null);
    await expect(
      board.rankFor(task, 'in_progress', 'missing'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('ignores the moving task’s own rank when reading its neighbours', async () => {
    // Otherwise a move within one column computes a rank against itself.
    const board = boardWith(['i', 'r']);
    const rank = await board.rankFor(task, 'todo');
    expect(rank).not.toBe('i');
  });
});

/**
 * Rank rebalancing.
 *
 * `rankBetween` lengthens the string whenever two neighbours are adjacent, and
 * the docstring has always pointed at `needsRebalance` as the answer.
 * `needsRebalance` and `evenlySpacedRanks` both existed; neither had a caller,
 * so ranks grew monotonically against a `varchar(64)` column that errors rather
 * than truncates.
 */
describe('TaskBoardService.rebalanceIfNeeded', () => {
  function boardWith(ranks: string[]) {
    const repo = {
      orderedForColumn: jest.fn(async () =>
        ranks.map((sortRank, i) => ({ id: `t${i}`, sortRank })),
      ),
      setRanks: jest.fn(
        async (updates: { id: string; sortRank: string }[]) => void updates,
      ),
    };
    const board = new TaskBoardService(repo as never, new ExceptionService());
    return { board, repo };
  }

  it('leaves a healthy column alone', async () => {
    const { board, repo } = boardWith(['i', 'r', 'v']);
    await expect(board.rebalanceIfNeeded('p1', 'todo')).resolves.toBe(0);
    expect(repo.setRanks).not.toHaveBeenCalled();
  });

  it('rewrites a column whose ranks have grown too long', async () => {
    const { board, repo } = boardWith(['0000000000001', 'i', 'r']);
    await expect(board.rebalanceIfNeeded('p1', 'todo')).resolves.toBe(3);
    const written = repo.setRanks.mock.calls[0][0];
    expect(written).toHaveLength(3);
    // Order is preserved and the new ranks are short and ascending.
    expect(written.map((w) => w.id)).toEqual(['t0', 't1', 't2']);
    for (let i = 1; i < written.length; i++) {
      expect(written[i - 1].sortRank < written[i].sortRank).toBe(true);
    }
    expect(written.every((w) => w.sortRank.length <= 12)).toBe(true);
  });

  it('handles a column larger than the alphabet', async () => {
    // The case the old `evenlySpacedRanks` collapsed into a run of 'z'.
    const long = '0'.repeat(13);
    const { board, repo } = boardWith([long, ...Array<string>(59).fill('i')]);
    await board.rebalanceIfNeeded('p1', 'todo');
    const written = repo.setRanks.mock.calls[0][0];
    expect(new Set(written.map((w) => w.sortRank)).size).toBe(60);
  });
});
