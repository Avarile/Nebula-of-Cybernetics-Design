import { ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { PaymentService } from './payment.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };

const TX = { __tx: true } as any;

function invoice(over: Partial<any> = {}) {
  return {
    id: 'inv1',
    number: 'INV-2026-0001',
    status: 'sent',
    currency: 'USD',
    total: '250.0000',
    amountPaid: '0.0000',
    projectId: null,
    contactId: 'c1',
    companyId: null,
    ...over,
  };
}

const payment = {
  amount: '250.0000',
  currency: 'USD',
  paidAt: new Date('2026-09-12T00:00:00.000Z'),
  method: 'bank_transfer',
  accountId: 'acc1',
} as any;

describe('PaymentService.recordPayment', () => {
  let db: any;
  let repo: any;
  let ledger: any;
  let svc: PaymentService;

  beforeEach(() => {
    db = { transaction: jest.fn(async (cb: any) => cb(TX)) };
    repo = {
      findById: jest.fn(async () => invoice()),
      // The real names on InvoiceRepository. These were `lineItemsFor` and
      // `paymentsFor` — methods that do not exist — so they mocked nothing.
      lineItems: jest.fn(async () => []),
      listPayments: jest.fn(async () => []),
      addPayment: jest.fn(async (values: any) => ({ id: 'pay1', ...values })),
      update: jest.fn(async () => invoice()),
      updateFromStatus: jest.fn(async () => invoice()),
      applyPayment: jest.fn(async () => invoice({ status: 'paid' })),
    };
    ledger = {
      postSettled: jest.fn(async () => ({ id: 'txn1' })),
      requireAccountFor: jest.fn(async () => ({
        id: 'acc1',
        name: 'Main',
        currency: 'USD',
      })),
    };
    svc = new PaymentService(
      db,
      repo,
      ledger,
      { recordSafe: jest.fn(async () => undefined) } as any,
      new ExceptionService(),
    );
  });

  it('posts the payment through the service so the balance actually moves', async () => {
    // The bug this test exists for: `InvoiceService` held a `LedgerRepository`,
    // so a recorded payment inserted a `cleared` income row and never reached
    // `applyEffects`. Reproduced live as stored=100 / derived=350 on the
    // account's own /reconcile endpoint.
    await svc.recordPayment('inv1', payment, user);
    expect(ledger.postSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'income',
        status: 'cleared',
        amount: '250.0000',
        accountId: 'acc1',
      }),
      TX,
    );
  });

  it('validates the account currency, not just the invoice currency', async () => {
    // A USD invoice paid into a EUR account used to post USD into a EUR
    // balance. Harmless while the balance was never touched; corrupting now.
    ledger.requireAccountFor.mockRejectedValueOnce(new Error('currency'));
    await expect(svc.recordPayment('inv1', payment, user)).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('checks the account before opening the transaction', async () => {
    await svc.recordPayment('inv1', payment, user);
    expect(ledger.requireAccountFor).toHaveBeenCalledWith('acc1', 'USD');
  });

  it('records a payment with no account without touching the ledger', async () => {
    await svc.recordPayment('inv1', { ...payment, accountId: undefined }, user);
    expect(ledger.postSettled).not.toHaveBeenCalled();
    expect(ledger.requireAccountFor).not.toHaveBeenCalled();
    expect(repo.addPayment).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: null }),
      TX,
    );
  });

  it('applies the payment relatively, in one guarded statement', async () => {
    // The header total is no longer computed here from a row read before the
    // transaction opened. Two concurrent payments both read amountPaid as
    // 0.0000 and both wrote their own absolute total, so one payment vanished
    // from the header while its payments row and its ledger posting survived.
    await svc.recordPayment('inv1', payment, user);
    expect(repo.applyPayment).toHaveBeenCalledWith(
      'inv1',
      '250.0000',
      payment.paidAt,
      TX,
    );
  });

  it('refuses to pay a draft invoice', async () => {
    repo.findById.mockResolvedValueOnce(invoice({ status: 'draft' }));
    await expect(svc.recordPayment('inv1', payment, user)).rejects.toThrow();
  });

  it('refuses a payment in a currency the invoice is not in', async () => {
    await expect(
      svc.recordPayment('inv1', { ...payment, currency: 'EUR' }, user),
    ).rejects.toThrow();
  });

  it('refuses to pay more than the invoice is owed', async () => {
    // Reproduced live: a 250.0000 invoice took a 10000.0000 payment, flipped to
    // `paid`, and posted 10000.0000 of income into the account.
    await expect(
      svc.recordPayment('inv1', { ...payment, amount: '10000.0000' }, user),
    ).rejects.toMatchObject({
      details: {
        issues: [
          {
            path: 'amount',
            message: expect.stringContaining('250.0000 USD outstanding'),
          },
        ],
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('bounds a payment by what is still outstanding, not by the total', async () => {
    repo.findById.mockResolvedValueOnce(
      invoice({ status: 'partially_paid', amountPaid: '200.0000' }),
    );
    await expect(
      svc.recordPayment('inv1', { ...payment, amount: '100.0000' }, user),
    ).rejects.toMatchObject({
      details: {
        issues: [{ message: expect.stringContaining('50.0000 USD') }],
      },
    });
  });

  it('refuses to pay an invoice that is already settled', async () => {
    // The status guard excluded only draft and void, so a paid invoice kept
    // accepting payments indefinitely.
    repo.findById.mockResolvedValueOnce(invoice({ status: 'paid' }));
    await expect(svc.recordPayment('inv1', payment, user)).rejects.toThrow(
      /Cannot pay a paid invoice/,
    );
  });

  it('fails the transaction when the invoice was settled concurrently', async () => {
    // The pre-checks passed but the guarded UPDATE matched nothing: another
    // payment took the room between the read and the write.
    repo.applyPayment.mockResolvedValueOnce(null);
    await expect(svc.recordPayment('inv1', payment, user)).rejects.toThrow(
      /paid by another request/,
    );
  });
});
