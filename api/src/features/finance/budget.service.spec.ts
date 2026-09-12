import { ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { BudgetService } from './budget.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };

describe('BudgetService', () => {
  let finance: any;
  let svc: BudgetService;

  beforeEach(() => {
    finance = {
      findCurrency: jest.fn(async () => ({ code: 'AUD' })),
      spendForScope: jest.fn(async () => '0.0000'),
      createBudget: jest.fn(async (v: any) => ({ id: 'b1', ...v })),
      listBudgets: jest.fn(async () => ({ rows: [], total: 0 })),
      budgetsAtRisk: jest.fn(async () => []),
    };
    svc = new BudgetService(
      finance,
      { recordSafe: jest.fn(async () => undefined) } as any,
      new ExceptionService(),
    );
  });

  describe('BudgetService.create', () => {
    it('seeds spentAmount from spend already on the ledger', async () => {
      // Budgets only ever accrued forward, so one created after the money went
      // out started at 0.0000 and under-reported for its whole period.
      finance.spendForScope.mockResolvedValueOnce('1250.5000');
      await svc.create(
        {
          name: 'Hosting',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          amount: '1500.0000',
          currency: 'AUD',
          alertThresholdPct: 80,
        } as any,
        user,
      );
      expect(finance.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          spentAmount: '1250.5000',
          status: 'active',
        }),
      );
    });

    it('opens as exceeded when the period is already over cap', async () => {
      finance.spendForScope.mockResolvedValueOnce('1800.0000');
      await svc.create(
        {
          name: 'Hosting',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          amount: '1500.0000',
          currency: 'AUD',
          alertThresholdPct: 80,
        } as any,
        user,
      );
      expect(finance.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'exceeded' }),
      );
    });
  });

  describe('atRisk', () => {
    it('computes usedPct without floats', async () => {
      finance.budgetsAtRisk.mockResolvedValueOnce([
        { id: 'b1', spentAmount: '2650.5000', amount: '3000.0000' },
      ]);
      await expect(svc.atRisk()).resolves.toEqual([
        { budget: expect.objectContaining({ id: 'b1' }), usedPct: 88 },
      ]);
    });

    it('lets the database apply the threshold, with no page cap', async () => {
      // This used to page the first 500 budgets and filter in JS, so budget 501
      // never alerted regardless of how far over its cap it was.
      await svc.atRisk();
      expect(finance.budgetsAtRisk).toHaveBeenCalledWith();
    });
  });

  it('refuses a period that ends before it starts', async () => {
    await expect(
      svc.create(
        {
          name: 'x',
          periodStart: '2026-09-30',
          periodEnd: '2026-09-01',
          amount: '1.0000',
          currency: 'AUD',
          alertThresholdPct: 80,
        } as any,
        user,
      ),
    ).rejects.toThrow();
  });
});
