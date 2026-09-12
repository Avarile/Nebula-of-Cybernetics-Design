import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('metadata decorators', () => {
  const reflector = new Reflector();

  it('@Public marks a handler public', () => {
    class Ctrl {
      @Public()
      handler() {}
    }
    expect(reflector.get(IS_PUBLIC_KEY, Ctrl.prototype.handler)).toBe(true);
  });

  it('@Roles records the allowed roles', () => {
    class Ctrl {
      @Roles('admin', 'agent')
      handler() {}
    }
    expect(reflector.get(ROLES_KEY, Ctrl.prototype.handler)).toEqual([
      'admin',
      'agent',
    ]);
  });
});
