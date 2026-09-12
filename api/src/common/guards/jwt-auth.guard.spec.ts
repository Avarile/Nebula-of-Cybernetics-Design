import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('bypasses authentication for @Public routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const context = { getHandler: () => ({}), getClass: () => ({}) } as any;
    expect(guard.canActivate(context)).toBe(true);
  });
});
