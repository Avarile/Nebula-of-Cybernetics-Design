import type { ArgumentMetadata } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  // metadata is ignored when the pipe is constructed with an explicit schema.
  const bodyMeta: ArgumentMetadata = { type: 'body' } as ArgumentMetadata;

  // Explicit per-route usage: `new ZodValidationPipe(schema)`.
  describe('with an explicit schema (per-route usage)', () => {
    const pipe = new ZodValidationPipe(z.object({ email: z.string().email() }));

    it('passes valid input through', () => {
      expect(pipe.transform({ email: 'a@b.co' }, bodyMeta)).toEqual({
        email: 'a@b.co',
      });
    });

    it('throws an AppException(VALIDATION_FAILED) with issues on invalid input', () => {
      try {
        pipe.transform({ email: 'nope' }, bodyMeta);
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
        expect((e as AppException).details).toHaveProperty('issues');
      }
    });
  });

  // Global APP_PIPE usage: no schema; validate by the param's createZodDto metatype.
  describe('as a global pipe (metatype-driven)', () => {
    const pipe = new ZodValidationPipe();
    class EmailDto extends createZodDto(
      z.object({ email: z.string().email() }),
    ) {}
    const meta = (metatype: unknown): ArgumentMetadata =>
      ({ type: 'body', metatype }) as ArgumentMetadata;

    it('validates a createZodDto param and passes valid input through', () => {
      expect(pipe.transform({ email: 'a@b.co' }, meta(EmailDto))).toEqual({
        email: 'a@b.co',
      });
    });

    it('throws AppException(VALIDATION_FAILED) for an invalid createZodDto param', () => {
      try {
        pipe.transform({ email: 'nope' }, meta(EmailDto));
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
      }
    });

    it('passes through params whose metatype is not a zod DTO', () => {
      expect(pipe.transform('raw-id', meta(String))).toBe('raw-id');
      expect(pipe.transform(42, meta(Number))).toBe(42);
    });
  });
});
