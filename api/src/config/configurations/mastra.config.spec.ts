import { mastraConfig } from './mastra.config';

describe('mastraConfig', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it('reads defaults', () => {
    process.env = { ...OLD };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-sonnet-4.6');
    expect(cfg.memoryLastMessages).toBe(20);
    expect(cfg.schedulesEnabled).toBe(false);
  });

  it('reads overrides from env', () => {
    process.env = {
      ...OLD,
      MASTRA_MODEL: 'anthropic/claude-opus-4.8',
      MASTRA_SCHEDULES_ENABLED: 'true',
    };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-opus-4.8');
    expect(cfg.schedulesEnabled).toBe(true);
  });
});
