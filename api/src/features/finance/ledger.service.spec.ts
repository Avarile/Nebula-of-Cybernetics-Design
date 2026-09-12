import { ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { LedgerService } from './ledger.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };

/** Stand-in for a Drizzle transaction handle, so we can assert it was passed. */
const TX = { __tx: true } as any;

function txn(row: Partial<any> = {}) {
  return {
    id: 't1',
    kind: 'income',
    status: 'cleared',
    amount: '100.0000',
    currency: 'USD',
    accountId: 'acc1',
    counterAccountId: null,
    categoryId: null,
    projectId: null,
    occurredOn: '2026-09-12',
    description: 'test',
    ...row,
  };
}

describe('LedgerService', () => {
  let db: any;
  let ledger: any;
  let finance: any;
  let activity: any;
  let svc: LedgerService;

  beforeEach(() => {
    db = { transaction: jest.fn(async (cb: any) => cb(TX)) };
    ledger = {
      create: jest.fn(async (values: any) => txn(values)),
      update: jest.fn(async (_id: string, patch: any) => txn(patch)),
      updateStatusFrom: jest.fn(async (_id: string, _from: string, s: string) =>
        txn({ status: s }),
      ),
      findById: jest.fn(async () => txn()),
      findByIdForUpdate: jest.fn(async () => txn()),
      findReversalOf: jest.fn(async () => null),
    };
    finance = {
      findAccount: jest.fn(async () => ({
        id: 'acc1',
        name: 'Main',
        currency: 'USD',
      })),
      findCategory: jest.fn(async () => null),
      findCurrency: jest.fn(async () => ({ code: 'USD' })),
      adjustBalance: jest.fn(async () => undefined),
      adjustBudgetSpend: jest.fn(async () => undefined),
      budgetsMatching: jest.fn(async () => []),
      spendForScope: jest.fn(async () => '0.0000'),
      createBudget: jest.fn(async (v: any) => ({ id: 'b1', ...v })),
      budgetsAtRisk: jest.fn(async () => []),
    };
    activity = { recordSafe: jest.fn(async () => undefined) };
    svc = new LedgerService(
      db,
      ledger,
      finance,
      activity,
      new ExceptionService(),
    );
  });

  describe('postSettled', () => {
    it('writes the row and moves the balance on the SAME executor', async () => {
      // The whole point of the method: the insert and the money it moves cannot
      // be separated by a caller, because they are one call.
      await svc.postSettled(txn() as any, TX);
      expect(ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '100.0000' }),
        TX,
      );
      expect(finance.adjustBalance).toHaveBeenCalledWith(
        'acc1',
        '100.0000',
        TX,
      );
    });

    it('does not move a balance for an unsettled transaction', async () => {
      ledger.create.mockResolvedValueOnce(txn({ status: 'draft' }));
      await svc.postSettled(txn({ status: 'draft' }) as any, TX);
      expect(finance.adjustBalance).not.toHaveBeenCalled();
    });

    it('debits the account for an expense', async () => {
      ledger.create.mockResolvedValueOnce(txn({ kind: 'expense' }));
      await svc.postSettled(txn({ kind: 'expense' }) as any, TX);
      expect(finance.adjustBalance).toHaveBeenCalledWith(
        'acc1',
        '-100.0000',
        TX,
      );
    });

    it('reads matching budgets inside the caller transaction', async () => {
      // Reading on the pool while writing in a transaction meant this decided
      // which budgets to charge from a different snapshot than it charged them in.
      ledger.create.mockResolvedValueOnce(txn({ kind: 'expense' }));
      await svc.postSettled(txn({ kind: 'expense' }) as any, TX);
      expect(finance.budgetsMatching).toHaveBeenCalledWith(
        expect.anything(),
        TX,
      );
    });
  });

  describe('setStatus', () => {
    it('patches the status THROUGH the transaction, not the pool', async () => {
      // The regression: `update` was called without `tx`, so it auto-committed
      // on its own connection. A failure in the effects then rolled back the
      // money and left the row claiming to be settled.
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'pending' }),
      );
      await svc.setStatus('t1', 'cleared', user);
      expect(ledger.updateStatusFrom).toHaveBeenCalledWith(
        't1',
        'pending',
        'cleared',
        TX,
      );
    });

    it('reads the row under a lock inside the transaction', async () => {
      // Reading on the pool and updating on `id` alone let twelve concurrent
      // `pending -> cleared` calls each decide from the same pre-transition
      // snapshot, applying one 100.0000 posting eight times.
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'pending' }),
      );
      await svc.setStatus('t1', 'cleared', user);
      expect(ledger.findByIdForUpdate).toHaveBeenCalledWith('t1', TX);
      expect(ledger.findById).not.toHaveBeenCalled();
    });

    it('refuses when the row moved out of the status it decided from', async () => {
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'pending' }),
      );
      ledger.updateStatusFrom.mockResolvedValueOnce(null);
      await expect(svc.setStatus('t1', 'cleared', user)).rejects.toThrow(
        /changed while this update was in flight/,
      );
      expect(finance.adjustBalance).not.toHaveBeenCalled();
    });

    it('is a no-op when the transaction is already in that status', async () => {
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'cleared' }),
      );
      await svc.setStatus('t1', 'cleared', user);
      expect(ledger.updateStatusFrom).not.toHaveBeenCalled();
      expect(finance.adjustBalance).not.toHaveBeenCalled();
    });

    it('applies the effects when a transaction becomes settled', async () => {
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'pending' }),
      );
      ledger.updateStatusFrom.mockResolvedValueOnce(txn({ status: 'cleared' }));
      await svc.setStatus('t1', 'cleared', user);
      expect(finance.adjustBalance).toHaveBeenCalledWith(
        'acc1',
        '100.0000',
        TX,
      );
    });

    it('reverses the effects when a settled transaction is un-settled', async () => {
      ledger.findByIdForUpdate.mockResolvedValueOnce(
        txn({ status: 'cleared' }),
      );
      ledger.updateStatusFrom.mockResolvedValueOnce(txn({ status: 'void' }));
      await svc.setStatus('t1', 'void', user);
      expect(finance.adjustBalance).toHaveBeenCalledWith(
        'acc1',
        '-100.0000',
        TX,
      );
    });
  });

  describe('reverse', () => {
    const transfer = txn({
      kind: 'transfer',
      accountId: 'from',
      counterAccountId: 'to',
    });

    it('SWAPS the legs of a transfer so the money comes back', async () => {
      // The defect this test exists for. `reverse` mapped transfer -> transfer
      // and copied both accounts across unswapped, so `applyEffects` debited
      // the sender and credited the receiver a second time: reversing a
      // 100.0000 transfer A -> B left A at 800.0000 and B at 1200.0000.
      //
      // It was invisible too — `reconcileBalance` derives by the same rule, so
      // both corrupted accounts reported inSync: true and the repair script had
      // nothing to detect.
      ledger.findById.mockResolvedValueOnce(transfer);
      ledger.findByIdForUpdate.mockResolvedValueOnce(transfer);
      await svc.reverse('t1', user);
      expect(ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'transfer',
          accountId: 'to',
          counterAccountId: 'from',
        }),
        TX,
      );
    });

    it('moves a reversed transfer back on both legs', async () => {
      ledger.findById.mockResolvedValueOnce(transfer);
      ledger.findByIdForUpdate.mockResolvedValueOnce(transfer);
      ledger.create.mockResolvedValueOnce(
        txn({ kind: 'transfer', accountId: 'to', counterAccountId: 'from' }),
      );
      await svc.reverse('t1', user);
      // The contra entry debits the original receiver and credits the original
      // sender: the exact inverse of the posting it undoes.
      expect(finance.adjustBalance).toHaveBeenCalledWith('to', '-100.0000', TX);
      expect(finance.adjustBalance).toHaveBeenCalledWith(
        'from',
        '100.0000',
        TX,
      );
    });

    it('flips income to expense against the same account', async () => {
      ledger.findById.mockResolvedValueOnce(txn({ kind: 'income' }));
      ledger.findByIdForUpdate.mockResolvedValueOnce(txn({ kind: 'income' }));
      await svc.reverse('t1', user);
      expect(ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'expense',
          accountId: 'acc1',
          counterAccountId: null,
        }),
        TX,
      );
    });

    it('refuses to reverse the same transaction twice', async () => {
      // `reverses_transaction_id` has no unique index, so two contra entries
      // against one original were accepted and the money moved twice.
      ledger.findById.mockResolvedValueOnce(txn({ kind: 'income' }));
      ledger.findByIdForUpdate.mockResolvedValueOnce(txn({ kind: 'income' }));
      ledger.findReversalOf.mockResolvedValueOnce(
        txn({ id: 't2', description: 'Reversal of: test' }),
      );
      await expect(svc.reverse('t1', user)).rejects.toThrow(/Already reversed/);
      expect(ledger.create).not.toHaveBeenCalled();
    });

    it('refuses to reverse an unsettled transaction', async () => {
      ledger.findById.mockResolvedValueOnce(txn({ status: 'pending' }));
      await expect(svc.reverse('t1', user)).rejects.toThrow(/void it instead/);
    });
  });

  describe('create', () => {
    it('checks BOTH legs of a transfer against the posting currency', async () => {
      // Only the source account was checked, so 100.0000 AUD transferred into a
      // USD account was credited there as 100.0000 USD.
      finance.findAccount
        .mockResolvedValueOnce({ id: 'acc1', name: 'Main', currency: 'USD' })
        .mockResolvedValueOnce({ id: 'acc2', name: 'Euro', currency: 'EUR' });
      await expect(
        svc.create(
          {
            kind: 'transfer',
            occurredOn: '2026-09-12',
            amount: '100.0000',
            currency: 'USD',
            accountId: 'acc1',
            counterAccountId: 'acc2',
            description: 'x',
            status: 'cleared',
          } as any,
          user,
        ),
      ).rejects.toMatchObject({
        details: {
          issues: [{ message: expect.stringContaining('is in EUR') }],
        },
      });
    });

    it('refuses an expense tagged with an income category', async () => {
      // `financial_categories.kind` was stored and never consulted, so
      // spend-by-category reported 44000.0000 of "spend" under client_revenue.
      finance.findCategory.mockResolvedValueOnce({
        id: 'cat1',
        name: 'Client Revenue',
        kind: 'income',
      });
      await expect(
        svc.create(
          {
            kind: 'expense',
            occurredOn: '2026-09-12',
            amount: '10.0000',
            currency: 'USD',
            accountId: 'acc1',
            categoryId: 'cat1',
            description: 'x',
            status: 'cleared',
          } as any,
          user,
        ),
      ).rejects.toMatchObject({
        details: {
          issues: [
            {
              path: 'categoryId',
              message: expect.stringContaining('is for income, not expense'),
            },
          ],
        },
      });
    });
  });

  describe('applyEffects budgets', () => {
    it('matches budgets on currency, not just scope and period', async () => {
      // A 500.0000 USD expense was added to an AUD budget as 500.0000, because
      // spent_amount inherits the budget's unit and the posting's was never
      // compared against it.
      ledger.create.mockResolvedValueOnce(
        txn({ kind: 'expense', currency: 'USD' }),
      );
      await svc.postSettled(
        txn({ kind: 'expense', currency: 'USD' }) as any,
        TX,
      );
      expect(finance.budgetsMatching).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        TX,
      );
    });
  });

  describe('requireAccountFor', () => {
    it('rejects a posting in a currency the account does not hold', async () => {
      await expect(svc.requireAccountFor('acc1', 'EUR')).rejects.toMatchObject({
        details: {
          issues: [
            { path: 'currency', message: expect.stringContaining('is in USD') },
          ],
        },
      });
    });

    it('returns the account when the currency agrees', async () => {
      await expect(svc.requireAccountFor('acc1', 'USD')).resolves.toMatchObject(
        { id: 'acc1' },
      );
    });
  });
});
