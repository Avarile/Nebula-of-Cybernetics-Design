import { ScheduledJobHandlerRegistry } from './job-handler.registry';

describe('ScheduledJobHandlerRegistry', () => {
  let registry: ScheduledJobHandlerRegistry;

  beforeEach(() => {
    registry = new ScheduledJobHandlerRegistry();
  });

  it('resolves a registered handler by kind', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registry.register('event_reminder', handler);
    await registry.get('event_reminder')!({} as never);
    expect(handler).toHaveBeenCalled();
  });

  it('returns undefined for an unregistered kind', () => {
    // The dispatcher turns this into `skipped`, never into `done`.
    expect(registry.get('event_start')).toBeUndefined();
  });

  it('refuses a duplicate registration', () => {
    // Two modules claiming one kind means one of them silently never runs.
    registry.register('event_reminder', jest.fn());
    expect(() => registry.register('event_reminder', jest.fn())).toThrow(
      /already registered/,
    );
  });

  it('reports what is registered', () => {
    registry.register('event_start', jest.fn());
    registry.register('event_reminder', jest.fn());
    expect(registry.registeredKinds()).toEqual([
      'event_reminder',
      'event_start',
    ]);
  });
});
