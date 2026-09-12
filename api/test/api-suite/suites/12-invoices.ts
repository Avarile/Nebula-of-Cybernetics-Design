import { isoDate, isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Invoicing, including the one flow that ties the whole fixture together:
 * time logged by the mock user against a task, billed onto an invoice raised
 * for the contact linked to the project.
 *
 * That path crosses four modules, so it is the single best proof that the data
 * model actually joins up rather than merely storing rows.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const currency = ctx.facts.currency ?? 'AUD';

  await client.call({
    name: 'a standard user cannot raise an invoice',
    method: 'POST',
    path: '/invoices',
    actor: 'user',
    body: {
      issueDate: isoDate(0),
      dueDate: isoDate(30),
      currency,
    },
    expect: 403,
  });

  const invoice = await client.call({
    name: 'admin raises an invoice against the project’s client',
    method: 'POST',
    path: '/invoices',
    actor: 'admin',
    body: {
      contactId: ctx.ids.contactId,
      companyId: ctx.ids.companyId,
      projectId: ctx.ids.projectId,
      issueDate: isoDate(0),
      dueDate: isoDate(30),
      currency,
      notes: `Raised by the live API suite run ${stamp}.`,
      terms: 'Net 30.',
    },
    expect: 201,
    assert: (b) =>
      b?.status === 'draft'
        ? undefined
        : `a new invoice should be draft, got ${b?.status}`,
  });
  if (invoice.ok) ctx.ids.invoiceId = invoice.body.id;

  await client.call({
    name: 'an invoice needs a bill-to contact or company',
    method: 'POST',
    path: '/invoices',
    actor: 'admin',
    body: {
      projectId: ctx.ids.projectId,
      issueDate: isoDate(0),
      dueDate: isoDate(30),
      currency,
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'an invoice needs an issue date and a due date',
    method: 'POST',
    path: '/invoices',
    actor: 'admin',
    body: { currency },
    expect: 400,
  });

  await client.call({
    name: 'an invoice cannot be due before it is issued',
    method: 'POST',
    path: '/invoices',
    actor: 'admin',
    body: { issueDate: isoDate(30), dueDate: isoDate(0), currency },
    expect: [400, 422],
  });

  if (!ctx.ids.invoiceId) {
    client.skip(
      'invoice lines',
      '/invoices/{id}/lines',
      'POST',
      'no invoice was raised',
    );
    return;
  }
  const id = ctx.ids.invoiceId;

  // ------------------------------------------------------------------- lines

  const line = await client.call({
    name: 'admin adds a fixed-price line',
    method: 'POST',
    path: '/invoices/{id}/lines',
    params: { id },
    actor: 'admin',
    body: {
      description: 'Discovery workshop',
      quantity: '1.0000',
      unit: 'engagement',
      unitPrice: '4500.0000',
      taxRatePct: '10.000',
      projectId: ctx.ids.projectId,
    },
    expect: 201,
  });
  if (line.ok) ctx.ids.invoiceLineId = line.body.id;

  await client.call({
    name: 'a malformed quantity is rejected',
    method: 'POST',
    path: '/invoices/{id}/lines',
    params: { id },
    actor: 'admin',
    body: { description: 'Bad qty', quantity: 'some', unitPrice: '10.0000' },
    expect: 400,
  });

  // FINDING: `taxRatePct` is validated only by the shape
  // /^\d{1,3}(\.\d{1,3})?$/, so any rate below 1000% is accepted. A 900% tax
  // line is booked without complaint. Asserted as it ought to behave.
  await client.call({
    name: 'a tax rate above 100% is rejected',
    method: 'POST',
    path: '/invoices/{id}/lines',
    params: { id },
    actor: 'admin',
    body: {
      description: 'Confiscatory',
      quantity: '1.0000',
      unitPrice: '10.0000',
      taxRatePct: '900.000',
    },
    expect: [400, 422],
  });

  // ------------------------------------------------------- billing real time

  const unbilled = await client.call({
    name: 'admin reads the unbilled time the mock user logged',
    method: 'GET',
    path: '/projects/{id}/unbilled-time',
    params: { id: ctx.ids.projectId ?? '' },
    actor: 'admin',
    expect: 200,
  });

  const entries: any[] = Array.isArray(unbilled.body)
    ? unbilled.body
    : (unbilled.body?.data ?? []);
  const timeEntryIds = entries
    .map((e) => e.id ?? e.entryId)
    .filter(Boolean)
    .slice(0, 5);

  if (timeEntryIds.length > 0 && ctx.ids.projectId) {
    await client.call({
      name: 'admin bills the logged time onto the invoice',
      method: 'POST',
      path: '/invoices/{id}/bill-time',
      params: { id },
      actor: 'admin',
      body: {
        projectId: ctx.ids.projectId,
        timeEntryIds,
        description: 'Engineering time — ingest worker',
        unitPrice: '185.0000',
        taxRatePct: '10.000',
      },
      expect: [200, 201],
    });

    await client.call({
      name: 'the billed time is no longer unbilled',
      method: 'GET',
      path: '/projects/{id}/unbilled-time',
      params: { id: ctx.ids.projectId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const stillThere = rows.filter((e) =>
          timeEntryIds.includes(e.id ?? e.entryId),
        );
        return stillThere.length === 0
          ? undefined
          : `${stillThere.length} billed entries are still reported as unbilled`;
      },
    });

    await client.call({
      name: 'billing the same time twice is refused',
      method: 'POST',
      path: '/invoices/{id}/bill-time',
      params: { id },
      actor: 'admin',
      body: {
        projectId: ctx.ids.projectId,
        timeEntryIds,
        description: 'Double bill',
        unitPrice: '185.0000',
      },
      expect: [400, 409, 422],
    });
  } else {
    client.skip(
      'admin bills the logged time onto the invoice',
      '/invoices/{id}/bill-time',
      'POST',
      'no unbilled time was available',
    );
  }

  // -------------------------------------------------------------- read + totals

  await client.call({
    name: 'admin reads the invoice with its lines and totals',
    method: 'GET',
    path: '/invoices/{id}',
    params: { id },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const lines: any[] = b?.lineItems ?? b?.lines ?? [];
      if (lines.length === 0) return 'the invoice has no line items';
      const total = b?.invoice?.total ?? b?.total;
      if (total === undefined) return 'the invoice carries no total';
      if (!Array.isArray(b?.payments))
        return 'the payments collection is missing';
      return undefined;
    },
  });

  await client.call({
    name: 'the invoice total is the sum of its line items',
    method: 'GET',
    path: '/invoices/{id}',
    params: { id },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const lines: any[] = b?.lineItems ?? [];
      const sum = lines.reduce((acc, l) => acc + Number(l.total ?? 0), 0);
      const total = Number(b?.invoice?.total ?? 0);
      return Math.abs(sum - total) < 0.005
        ? undefined
        : `line items sum to ${sum.toFixed(4)} but the invoice total is ${total.toFixed(4)}`;
    },
  });

  await client.call({
    name: 'admin lists invoices for the project',
    method: 'GET',
    path: '/invoices',
    actor: 'admin',
    query: { projectId: ctx.ids.projectId, page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((i) => i.id === id)
        ? undefined
        : 'the invoice is not listed under its project';
    },
  });

  await client.call({
    name: 'invoices can be filtered by status',
    method: 'GET',
    path: '/invoices',
    actor: 'admin',
    query: { status: 'draft', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((i) => i.status !== 'draft');
      return wrong
        ? `status filter leaked a ${wrong.status} invoice`
        : undefined;
    },
  });

  await client.call({
    name: 'a standard user cannot read invoices',
    method: 'GET',
    path: '/invoices',
    actor: 'user',
    expect: 403,
  });

  // ------------------------------------------------------------- issue + pay

  await client.call({
    name: 'admin issues the invoice',
    method: 'POST',
    path: '/invoices/{id}/issue',
    params: { id },
    actor: 'admin',
    expect: [200, 201],
    assert: (b) =>
      b?.status === 'sent' || b?.status === 'issued'
        ? undefined
        : `status after issue was ${b?.status}`,
  });

  await client.call({
    name: 'lines cannot be added to an issued invoice',
    method: 'POST',
    path: '/invoices/{id}/lines',
    params: { id },
    actor: 'admin',
    body: {
      description: 'Late addition',
      quantity: '1.0000',
      unitPrice: '1.0000',
    },
    expect: [400, 409, 422],
  });

  await client.call({
    name: 'admin records a partial payment',
    method: 'POST',
    path: '/invoices/{id}/payments',
    params: { id },
    actor: 'admin',
    body: {
      amount: '1000.0000',
      currency,
      paidAt: isoDateTime(0),
      method: 'bank_transfer',
      reference: `PAY-${stamp.slice(-6)}`,
      accountId: ctx.ids.accountId,
    },
    expect: [200, 201],
  });

  await client.call({
    name: 'the invoice reflects the partial payment',
    method: 'GET',
    path: '/invoices/{id}',
    params: { id },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const inv = b?.invoice ?? b;
      if (Number(inv?.amountPaid ?? 0) <= 0)
        return `amountPaid is ${inv?.amountPaid}`;
      if (inv?.status !== 'partially_paid') return `status is ${inv?.status}`;
      return (b?.payments ?? []).length > 0
        ? undefined
        : 'the payment is not listed';
    },
  });

  await client.call({
    name: 'a payment in the wrong currency is refused',
    method: 'POST',
    path: '/invoices/{id}/payments',
    params: { id },
    actor: 'admin',
    body: {
      amount: '10.0000',
      currency: currency === 'AUD' ? 'USD' : 'AUD',
      paidAt: isoDateTime(0),
    },
    expect: [400, 409, 422],
  });

  await client.call({
    name: 'admin reads overdue invoices',
    method: 'GET',
    path: '/invoices/overdue',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const notYetDue = rows.find((i) => i.id === id);
      return notYetDue
        ? 'an invoice due in 30 days is being reported as overdue'
        : undefined;
    },
  });

  if (ctx.ids.invoiceLineId) {
    await client.call({
      name: 'a line cannot be removed from an issued invoice',
      method: 'DELETE',
      path: '/invoices/{id}/lines/{lineId}',
      params: { id, lineId: ctx.ids.invoiceLineId },
      actor: 'admin',
      expect: [400, 409, 422],
    });
  }

  // ---------------------------------------------------------------- void path

  const voidable = await client.call({
    name: 'admin raises a second invoice to void',
    method: 'POST',
    path: '/invoices',
    actor: 'admin',
    body: {
      contactId: ctx.ids.contactId,
      projectId: ctx.ids.projectId,
      issueDate: isoDate(0),
      dueDate: isoDate(14),
      currency,
      notes: 'Raised in error.',
    },
    expect: 201,
  });

  if (voidable.ok) {
    ctx.ids.voidInvoiceId = voidable.body.id;

    const scratchLine = await client.call({
      name: 'admin adds a line to the second invoice',
      method: 'POST',
      path: '/invoices/{id}/lines',
      params: { id: voidable.body.id },
      actor: 'admin',
      body: {
        description: 'Scratch',
        quantity: '2.0000',
        unitPrice: '50.0000',
      },
      expect: 201,
    });

    if (scratchLine.ok) {
      await client.call({
        name: 'a line can be removed from a draft invoice',
        method: 'DELETE',
        path: '/invoices/{id}/lines/{lineId}',
        params: { id: voidable.body.id, lineId: scratchLine.body.id },
        actor: 'admin',
        expect: 204,
      });
    }

    await client.call({
      name: 'admin voids the second invoice',
      method: 'POST',
      path: '/invoices/{id}/void',
      params: { id: voidable.body.id },
      actor: 'admin',
      expect: [200, 201],
      assert: (b) =>
        b?.status === 'void' ? undefined : `status was ${b?.status}`,
    });

    await client.call({
      name: 'a voided invoice cannot take a payment',
      method: 'POST',
      path: '/invoices/{id}/payments',
      params: { id: voidable.body.id },
      actor: 'admin',
      body: { amount: '10.0000', currency, paidAt: isoDateTime(0) },
      expect: [400, 409, 422],
    });
  }

  await client.call({
    name: 'an unknown invoice id is a 404',
    method: 'GET',
    path: '/invoices/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'admin',
    expect: 404,
  });
}
