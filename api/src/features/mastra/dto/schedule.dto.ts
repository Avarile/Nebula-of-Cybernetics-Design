import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AGENT_ID } from '../mastra.constants';

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  cron: z.string().min(1).max(120),
  timezone: z.string().max(64).default('UTC'),
  /**
   * Accepted for forward compatibility but currently ignored: the processor
   * always runs the scheduled-report workflow. Constrained to the one agent
   * that exists so the API cannot promise routing it does not do.
   */
  agentId: z.literal(AGENT_ID).default(AGENT_ID),
  promptTemplate: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  /**
   * Defaults to `none` because it is the only channel that works: `conversation`
   * and `email` delivery are unimplemented and now fail the run rather than
   * reporting a delivery that never happened. The report is readable on the
   * `agent_run` row either way.
   */
  deliveryChannel: z.enum(['conversation', 'email', 'none']).default('none'),
  deliveryTarget: z.string().max(500).optional(),
  targetUserId: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
});

export class CreateScheduleDto extends createZodDto(createScheduleSchema) {}
