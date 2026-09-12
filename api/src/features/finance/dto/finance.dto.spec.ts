import {
  addLineItemSchema,
  billTimeSchema,
  upsertFxRateSchema,
} from './finance.dto';

/**
 * `taxRatePct` used to be validated by pattern alone — `^\d{1,3}(\.\d{1,3})?$`
 * — which bounds the number of digits and not the value. A 900% tax line was
 * accepted and booked, and the invoice total was computed from it.
 */
describe('taxRatePct', () => {
  const line = (taxRatePct?: string) => ({
    description: 'Consulting',
    quantity: '1.0000',
    unitPrice: '100.0000',
    ...(taxRatePct === undefined ? {} : { taxRatePct }),
  });

  it('accepts a rate at or below 100%', () => {
    for (const rate of ['0', '10', '10.5', '99.999', '100']) {
      expect(addLineItemSchema.safeParse(line(rate)).success).toBe(true);
    }
  });

  it('rejects a rate above 100%', () => {
    for (const rate of ['100.001', '101', '900', '999.999']) {
      const parsed = addLineItemSchema.safeParse(line(rate));
      expect(parsed.success).toBe(false);
    }
  });

  it('still rejects anything that is not a decimal percentage', () => {
    for (const rate of ['ten', '-5', '1.23456', '']) {
      expect(addLineItemSchema.safeParse(line(rate)).success).toBe(false);
    }
  });

  it('defaults to zero when omitted', () => {
    const parsed = addLineItemSchema.parse(line());
    expect(parsed.taxRatePct).toBe('0');
  });

  // Both entry points into an invoice line share the rule; billing time used to
  // carry its own copy of the pattern and could drift from the other.
  it('applies the same bound when billing time', () => {
    const billed = (taxRatePct: string) => ({
      projectId: '00000000-0000-4000-8000-000000000000',
      timeEntryIds: ['00000000-0000-4000-8000-000000000001'],
      description: 'Engineering time',
      unitPrice: '185.0000',
      taxRatePct,
    });
    expect(billTimeSchema.safeParse(billed('10')).success).toBe(true);
    expect(billTimeSchema.safeParse(billed('900')).success).toBe(false);
  });
});

describe('upsertFxRateSchema', () => {
  const rate = (over: Record<string, unknown> = {}) => ({
    baseCode: 'AUD',
    quoteCode: 'USD',
    rate: '0.6543210000',
    asOf: '2026-09-06',
    ...over,
  });

  it('accepts a well-formed rate and upper-cases the codes', () => {
    const parsed = upsertFxRateSchema.parse(rate({ baseCode: 'aud' }));
    expect(parsed.baseCode).toBe('AUD');
  });

  it('keeps ten decimal places', () => {
    // Thin-traded pairs genuinely need them; truncating here would round the
    // archive the ledger is meant to be reconciled against.
    expect(upsertFxRateSchema.parse(rate()).rate).toBe('0.6543210000');
  });

  it('rejects a zero or negative rate', () => {
    expect(upsertFxRateSchema.safeParse(rate({ rate: '0' })).success).toBe(
      false,
    );
    expect(upsertFxRateSchema.safeParse(rate({ rate: '-1' })).success).toBe(
      false,
    );
  });

  it('rejects a currency code that is not three characters', () => {
    expect(
      upsertFxRateSchema.safeParse(rate({ baseCode: 'AUDD' })).success,
    ).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(
      upsertFxRateSchema.safeParse(rate({ asOf: '06-09-2026' })).success,
    ).toBe(false);
  });
});
