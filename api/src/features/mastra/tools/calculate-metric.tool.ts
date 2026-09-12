import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CuratedMetric } from '../mastra.types';

export const calculateMetricInput = z.object({
  metric: z.string().min(1),
  period: z.string().min(1),
  groupBy: z.string().optional(),
});
export type CalculateMetricInput = z.infer<typeof calculateMetricInput>;

/**
 * Pure logic — unit tested. v1 STUB for the heavy-aggregation pattern: returns a
 * curated, capped metric shape. When the finance/worklog domain exists, replace the
 * body with a real repository aggregation behind this same signature.
 */
export async function calculateMetricExecute(
  input: CalculateMetricInput,
): Promise<CuratedMetric> {
  return {
    metric: input.metric,
    value: 0,
    unit: 'unknown',
    period: input.period,
    breakdown: [],
  };
}

export function makeCalculateMetricTool() {
  return createTool({
    id: 'calculate-metric',
    description:
      'Compute an aggregated business metric (e.g. total income) for a period. Returns a compact number + breakdown, never raw rows. Read-only.',
    inputSchema: calculateMetricInput,
    outputSchema: z.object({
      metric: z.string(),
      value: z.number(),
      unit: z.string(),
      period: z.string(),
      breakdown: z.array(z.object({ key: z.string(), value: z.number() })),
    }),
    execute: async (input: CalculateMetricInput) =>
      calculateMetricExecute(input),
  });
}
