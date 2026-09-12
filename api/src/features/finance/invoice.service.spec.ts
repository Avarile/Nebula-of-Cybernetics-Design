import { ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { InvoiceService } from './invoice.service';

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

describe('InvoiceService.void', () => {
  let repo: any;
  let svc: InvoiceService;

  beforeEach(() => {
    repo = {
      findById: jest.fn(async () => invoice()),
      update: jest.fn(async () => invoice({ status: 'void' })),
      updateFromStatus: jest.fn(async () => invoice({ status: 'void' })),
    };
    svc = new InvoiceService(
      { transaction: jest.fn(async (cb: any) => cb(TX)) } as any,
      repo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { recordSafe: jest.fn(async () => undefined) } as any,
      new ExceptionService(),
    );
  });

  it('refuses to void an invoice that has taken money', async () => {
    // Reproduced live: a partially paid invoice voided cleanly while its
    // payments and their cleared income transactions stayed posted, so the
    // account kept 150.0000 of revenue for an invoice that did not happen.
    repo.findById.mockResolvedValueOnce(
      invoice({ status: 'partially_paid', amountPaid: '150.0000' }),
    );
    await expect(svc.void('inv1', user)).rejects.toThrow(
      /Reverse those payments before voiding/,
    );
    expect(repo.updateFromStatus).not.toHaveBeenCalled();
  });

  it('voids an unpaid invoice', async () => {
    repo.findById.mockResolvedValueOnce(
      invoice({ status: 'sent', amountPaid: '0.0000' }),
    );
    await expect(svc.void('inv1', user)).resolves.toMatchObject({
      status: 'void',
    });
  });

  it('still refuses a fully paid invoice', async () => {
    repo.findById.mockResolvedValueOnce(
      invoice({ status: 'paid', amountPaid: '250.0000' }),
    );
    await expect(svc.void('inv1', user)).rejects.toThrow(/refund it instead/);
  });
});
