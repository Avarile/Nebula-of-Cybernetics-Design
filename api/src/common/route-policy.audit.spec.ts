import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import {
  assertEveryRouteDeclaresPolicy,
  checkCatchAllIsLast,
} from './route-policy.audit';

@Controller('declared')
@Roles('admin')
class ClassRolesController {
  @Get()
  list() {
    return [];
  }
}

@Controller('mixed')
class MethodLevelController {
  @Get('open')
  @Public()
  open() {
    return 'ok';
  }

  @Get('closed')
  @Roles('user', 'admin')
  closed() {
    return 'ok';
  }

  // Not a route — TypeScript's `private` is erased at runtime, so the scanner
  // has to distinguish this from a handler by route metadata, not by name.
  private helper() {
    return 'internal';
  }
}

@Controller('undeclared')
class UndeclaredController {
  @Get()
  leaky() {
    return 'anyone authenticated can read this';
  }
}

async function appWith(...controllers: unknown[]) {
  const moduleRef = await Test.createTestingModule({
    controllers: controllers as never,
    providers: [Reflector],
  }).compile();
  return moduleRef.createNestApplication();
}

describe('assertEveryRouteDeclaresPolicy', () => {
  it('passes when every route declares @Roles or @Public', async () => {
    const app = await appWith(ClassRolesController, MethodLevelController);
    expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
    await app.close();
  });

  it('throws, naming the offending route, when a route declares neither', async () => {
    const app = await appWith(ClassRolesController, UndeclaredController);
    expect(() => assertEveryRouteDeclaresPolicy(app)).toThrow(
      /UndeclaredController\.leaky/,
    );
    await app.close();
  });

  it('does not flag non-route helper methods on a controller', async () => {
    const app = await appWith(MethodLevelController);
    expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
    await app.close();
  });

  it('reports every offender at once rather than failing on the first', async () => {
    @Controller('a')
    class A {
      @Get()
      one() {
        return 1;
      }
    }
    @Controller('b')
    class B {
      @Get()
      two() {
        return 2;
      }
    }
    const app = await appWith(A, B);
    try {
      assertEveryRouteDeclaresPolicy(app);
      throw new Error('expected the audit to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('A.one');
      expect(message).toContain('B.two');
      expect(message).toContain('2 route(s)');
    }
    await app.close();
  });
});
// Named to match the real catch-all controller from `@mastra/nestjs`, which is
// what `CATCH_ALL_CONTROLLERS` keys on.
@Controller('agent-core')
@Roles('user', 'admin')
class MastraController {
  @Get('*path')
  proxy() {
    return 'anything';
  }
}

describe('checkCatchAllIsLast', () => {
  it('returns null when the catch-all controller is registered last', async () => {
    const app = await appWith(ClassRolesController, MastraController);
    expect(checkCatchAllIsLast(app)).toBeNull();
    await app.close();
  });

  it('returns null when no catch-all controller is present at all', async () => {
    const app = await appWith(ClassRolesController, MethodLevelController);
    expect(checkCatchAllIsLast(app)).toBeNull();
    await app.close();
  });

  it('names the controllers a misplaced catch-all would swallow', async () => {
    const app = await appWith(MastraController, ClassRolesController);
    const warning = checkCatchAllIsLast(app);
    expect(warning).toContain('MastraController');
    expect(warning).toContain('ClassRolesController');
    await app.close();
  });

  // Deliberately a warning, not a crash: registration order is inferred from
  // Nest's container insertion order and from the order @mastra/nestjs lists
  // its own controllers in. Both are third-party implementation details, and
  // refusing to boot on a heuristic about a convention is a worse failure than
  // the routing mystery it prevents.
  it('does not stop the boot audit when the ordering looks wrong', async () => {
    const app = await appWith(MastraController, ClassRolesController);
    expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
    await app.close();
  });
});
