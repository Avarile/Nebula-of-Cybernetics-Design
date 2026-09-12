// See search-query.tool.spec.ts for why `@mastra/core/tools` is stubbed here.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { calculateMetricExecute } from './calculate-metric.tool';

describe('calculateMetricExecute', () => {
  it('returns a curated metric with a stable shape (v1 stub)', async () => {
    const out = await calculateMetricExecute({
      metric: 'income',
      period: '2026-06',
      groupBy: 'category',
    });
    expect(out).toEqual(
      expect.objectContaining({
        metric: 'income',
        period: '2026-06',
        unit: expect.any(String),
      }),
    );
    expect(Array.isArray(out.breakdown)).toBe(true);
  });
});
