import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isValidTimeZone } from '../timezone';

/**
 * `YYYY-MM-DD`, optionally with a time. Deliberately NOT an ISO instant: these
 * fields are wall clock, and accepting `2025-10-05T09:00:00Z` here would let a
 * client hand us an instant that we would then reinterpret as a local reading.
 */
export const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

const wallClock = z
  .string()
  .regex(WALL_CLOCK, 'Expected a local YYYY-MM-DD[ HH:MM[:SS]] value');

const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Unknown IANA time zone');

export const RECURRENCE_FREQUENCIES = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
] as const;

/** A month of lead time. Beyond that a "reminder" is a separate event. */
const MAX_REMINDER_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;

const eventFields = {
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullish(),
  location: z.string().max(300).nullish(),
  /** Interpreted against `timezone`; the UTC instant is derived, never sent. */
  startLocal: wallClock,
  /** Wall-clock minutes. A 09:00-10:00 meeting is 60, on every day of the year. */
  durationMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 366),
  timezone: timeZone,
  allDay: z.boolean(),
  status: z.enum(['confirmed', 'tentative']),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(1000),
  /** WEEKLY only. `0 = Sunday` … `6 = Saturday`. */
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7),
  count: z.number().int().min(1).max(1000).nullish(),
  untilLocal: wallClock.nullish(),
  /**
   * Lead times in ms before the start. Capped at ten because each one is a row
   * per occurrence per horizon — the multiplication is what fills the table.
   */
  reminderOffsetsMs: z
    .array(z.number().int().min(0).max(MAX_REMINDER_OFFSET_MS))
    .max(10),
  projectId: z.string().uuid().nullish(),
};

export const createEventSchema = z.object({
  ...eventFields,
  description: eventFields.description.optional(),
  location: eventFields.location.optional(),
  durationMinutes: eventFields.durationMinutes.default(0),
  allDay: eventFields.allDay.default(false),
  status: eventFields.status.default('confirmed'),
  frequency: eventFields.frequency.default('none'),
  interval: eventFields.interval.default(1),
  byWeekday: eventFields.byWeekday.default([]),
  reminderOffsetsMs: eventFields.reminderOffsetsMs.default([]),
});

export class CreateEventDto extends createZodDto(createEventSchema) {}

export const updateEventSchema = z
  .object(eventFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateEventDto extends createZodDto(updateEventSchema) {}

/**
 * A calendar range, expressed the way the viewer sees it.
 *
 * `from`/`to` are LOCAL dates and `to` is exclusive. The UTC bounds are derived
 * here, at the boundary, because `09:00 1 September` in Melbourne is `23:00 31
 * August` UTC and a range built from the naive instant silently drops it.
 */
export const listRangeSchema = z.object({
  from: wallClock,
  to: wallClock,
  /** Defaults to the caller's profile timezone. */
  timezone: timeZone.optional(),
  limit: z.coerce.number().int().positive().max(1000).default(500),
});

export class ListRangeDto extends createZodDto(listRangeSchema) {}

export const listEventsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListEventsDto extends createZodDto(listEventsSchema) {}

/**
 * Move or retitle ONE instance of a series.
 *
 * `original_start` is not settable and never changes: it is the instance's
 * permanent identity, and it is what lets every future re-expansion recognise
 * this row and leave it alone.
 */
export const moveOccurrenceSchema = z
  .object({
    startLocal: wallClock.optional(),
    durationMinutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 366)
      .optional(),
    title: z.string().min(1).max(300).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class MoveOccurrenceDto extends createZodDto(moveOccurrenceSchema) {}

export const listDeadJobsSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export class ListDeadJobsDto extends createZodDto(listDeadJobsSchema) {}
