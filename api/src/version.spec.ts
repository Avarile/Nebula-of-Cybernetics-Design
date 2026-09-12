import { version as packageVersion } from '../package.json';

/**
 * Load the module against a fresh registry.
 *
 * Build identity is captured at import time by design — it cannot change while
 * the process runs — so a clean registry per case is the only way to exercise
 * both the stamped and unstamped builds.
 */
async function load(sha?: string): Promise<typeof import('./version')> {
  if (sha === undefined) delete process.env.GIT_SHA;
  else process.env.GIT_SHA = sha;

  let mod!: typeof import('./version');
  await jest.isolateModulesAsync(async () => {
    mod = await import('./version');
  });
  return mod;
}

describe('build identity', () => {
  const original = process.env.GIT_SHA;

  afterEach(() => {
    if (original === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = original;
  });

  // The whole point of reading package.json instead of a literal or an env
  // var: there is no second copy of this number left to drift.
  it('reports the version package.json ships', async () => {
    const { VERSION, BUILD_INFO } = await load();
    expect(VERSION).toBe(packageVersion);
    expect(BUILD_INFO.version).toBe(packageVersion);
  });

  it('omits the sha when nothing stamped the build', async () => {
    const { GIT_SHA, RELEASE, BUILD_INFO } = await load();
    expect(GIT_SHA).toBeNull();
    expect(BUILD_INFO.sha).toBeNull();
    expect(RELEASE).toBe(`cybernetics@${packageVersion}`);
  });

  it('shortens a stamped sha and carries it into the release', async () => {
    const { GIT_SHA, RELEASE } = await load(
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    );
    expect(GIT_SHA).toBe('a1b2c3d');
    expect(RELEASE).toBe(`cybernetics@${packageVersion}+a1b2c3d`);
  });

  // A blank value is what an unset Docker build arg leaves behind. Treating it
  // as "unstamped" keeps a dangling `cybernetics@0.0.1+` out of Sentry's
  // release list, where it would look like a distinct build.
  it('treats a blank stamp as unstamped', async () => {
    const { GIT_SHA, RELEASE } = await load('   ');
    expect(GIT_SHA).toBeNull();
    expect(RELEASE).toBe(`cybernetics@${packageVersion}`);
  });
});
