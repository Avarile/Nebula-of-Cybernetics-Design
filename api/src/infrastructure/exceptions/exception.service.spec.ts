import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  BadGatewayException,
} from '@nestjs/common';
import { ZodError, z } from 'zod';
import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';
import { ExceptionService } from './exception.service';

describe('ExceptionService', () => {
  const svc = new ExceptionService();

  it('create() builds an AppException from a code', () => {
    const err = svc.create(ErrorCode.USER_NOT_FOUND);
    expect(err).toBeInstanceOf(AppException);
    expect(err.getStatus()).toBe(404);
  });

  it('validation() shapes details.issues', () => {
    const err = svc.validation([{ path: 'email', message: 'required' }]);
    expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(err.details).toEqual({
      issues: [{ path: 'email', message: 'required' }],
    });
  });

  describe('from()', () => {
    it('passes an AppException through unchanged', () => {
      const orig = svc.create(ErrorCode.USER_NOT_FOUND);
      expect(svc.from(orig)).toBe(orig);
    });

    it('maps a Nest HttpException by status', () => {
      expect(svc.from(new NotFoundException('nope')).code).toBe(
        ErrorCode.NOT_FOUND,
      );
    });

    it('preserves an unmapped 4xx HttpException status instead of masking it as 500', () => {
      const mapped = svc.from(new PayloadTooLargeException('too big'));
      expect(mapped.code).toBe(ErrorCode.CLIENT_ERROR);
      expect(mapped.kind).toBe('CLIENT');
      expect(mapped.getStatus()).toBe(413);
      expect(mapped.message).toBe('too big');
    });

    it('preserves other unmapped 4xx statuses (e.g. 422)', () => {
      expect(svc.from(new UnprocessableEntityException()).getStatus()).toBe(
        422,
      );
    });

    it('treats an unmapped 5xx HttpException as INTERNAL_ERROR', () => {
      const mapped = svc.from(new BadGatewayException('upstream said no'));
      expect(mapped.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(mapped.getStatus()).toBe(500);
    });

    it('maps a zod-pipe validation body to VALIDATION_FAILED with issues', () => {
      const body = {
        message: 'Validation failed',
        issues: [{ path: 'a', message: 'bad' }],
      };
      const mapped = svc.from(new BadRequestException(body));
      expect(mapped.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(mapped.details).toEqual({
        issues: [{ path: 'a', message: 'bad' }],
      });
    });

    it('maps a ZodError to VALIDATION_FAILED', () => {
      let zerr: ZodError;
      try {
        z.object({ a: z.string() }).parse({});
      } catch (e) {
        zerr = e as ZodError;
      }
      const mapped = svc.from(zerr!);
      expect(mapped.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(Array.isArray((mapped.details as any).issues)).toBe(true);
    });

    it('maps a Mastra-shaped error', () => {
      const m = Object.assign(new Error('x'), {
        id: 'I',
        domain: 'LLM',
        category: 'THIRD_PARTY',
      });
      expect(svc.from(m).code).toBe(ErrorCode.LLM_PROVIDER_ERROR);
    });

    it('maps a pg unique violation to CONFLICT', () => {
      expect(svc.from(Object.assign(new Error(), { code: '23505' })).code).toBe(
        ErrorCode.CONFLICT,
      );
    });

    it('falls back to INTERNAL_ERROR for unknown errors, keeping the cause', () => {
      const raw = new Error('mystery');
      const mapped = svc.from(raw);
      expect(mapped.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(mapped.cause).toBe(raw);
    });
  });
});
