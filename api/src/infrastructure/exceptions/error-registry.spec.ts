import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

describe('ERROR_REGISTRY', () => {
  it('has exactly one spec for every ErrorCode', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_REGISTRY[code]).toBeDefined();
    }
    expect(Object.keys(ERROR_REGISTRY).sort()).toEqual(
      Object.values(ErrorCode).sort(),
    );
  });

  it('every spec has a valid status, a known kind, and a non-empty message', () => {
    for (const spec of Object.values(ERROR_REGISTRY)) {
      expect(Object.values(HttpStatus)).toContain(spec.status);
      expect(Object.values(ErrorKind)).toContain(spec.kind);
      expect(spec.message.length).toBeGreaterThan(0);
    }
  });

  it('CLIENT specs are 4xx; DEPENDENCY/INTERNAL are 5xx', () => {
    for (const spec of Object.values(ERROR_REGISTRY)) {
      if (spec.kind === ErrorKind.CLIENT) {
        expect(spec.status).toBeGreaterThanOrEqual(400);
        expect(spec.status).toBeLessThan(500);
      } else {
        expect(spec.status).toBeGreaterThanOrEqual(500);
      }
    }
  });
});
