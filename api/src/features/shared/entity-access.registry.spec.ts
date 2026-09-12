import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import { EntityAccessRegistry } from './entity-access.registry';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

describe('EntityAccessRegistry', () => {
  let registry: EntityAccessRegistry;

  beforeEach(() => {
    registry = new EntityAccessRegistry();
  });

  describe('with no resolver registered', () => {
    // The property that matters: adding a value to `commentable_type` must not
    // make it readable until a module vouches for it.
    it.each`
      label          | principal           | expected
      ${'user'}      | ${user}             | ${false}
      ${'service'}   | ${service}          | ${false}
      ${'anonymous'} | ${GUEST_PRINCIPAL}  | ${false}
      ${'admin'}     | ${admin}            | ${true}
      ${'system'}    | ${SYSTEM_PRINCIPAL} | ${true}
    `('$label is $expected', async ({ principal, expected }) => {
      await expect(registry.canRead('project', 'p1', principal)).resolves.toBe(
        expected,
      );
    });
  });

  describe('with a resolver registered', () => {
    beforeEach(() => {
      registry.register('project', async (id) => id === 'allowed');
    });

    it('delegates the decision for a normal user', async () => {
      await expect(registry.canRead('project', 'allowed', user)).resolves.toBe(
        true,
      );
      await expect(registry.canRead('project', 'denied', user)).resolves.toBe(
        false,
      );
    });

    it('still short-circuits for admin and system without consulting it', async () => {
      const check = jest.fn(async () => false);
      registry.register('task', check);
      await expect(registry.canRead('task', 'x', admin)).resolves.toBe(true);
      await expect(
        registry.canRead('task', 'x', SYSTEM_PRINCIPAL),
      ).resolves.toBe(true);
      expect(check).not.toHaveBeenCalled();
    });

    it('denies an entity type that has no resolver', async () => {
      await expect(registry.canRead('knowledge', 'k1', user)).resolves.toBe(
        false,
      );
    });
  });

  it('refuses a duplicate registration rather than letting one win silently', () => {
    registry.register('project', async () => true);
    expect(() => registry.register('project', async () => false)).toThrow(
      /already registered/,
    );
  });

  it('reports what has been registered', () => {
    registry.register('task', async () => true);
    registry.register('project', async () => true);
    expect(registry.registeredTypes()).toEqual(['project', 'task']);
  });
});
