import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { TimeoutError } from '../../common/with-timeout';
import type { AccessTokenClaims } from './auth.types';
import { TokenValidityService } from './token-validity.service';

const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + HOUR);
const past = () => new Date(Date.now() - HOUR);

const userClaims: AccessTokenClaims = {
  sub: 'u-1',
  role: 'user',
  kind: 'user',
  sid: 'sess-1',
};
const serviceClaims: AccessTokenClaims = {
  sub: 'cred-1',
  role: 'agent',
  kind: 'service',
};

function make(
  over: {
    session?: unknown;
    credential?: unknown;
    cache?: Partial<{
      get: jest.Mock;
      set: jest.Mock;
      destroy: jest.Mock;
    }>;
  } = {},
) {
  const sessions = {
    findLiveById: jest.fn(async () =>
      'session' in over ? over.session : { id: 'sess-1', userId: 'u-1' },
    ),
  };
  const credentials = {
    findLiveById: jest.fn(async () =>
      'credential' in over
        ? over.credential
        : { id: 'cred-1', expiresAt: null },
    ),
  };
  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    destroy: jest.fn(async () => undefined),
    ...over.cache,
  };
  const service = new TokenValidityService(
    sessions as never,
    credentials as never,
    cache as never,
    new ExceptionService(),
  );
  return { service, sessions, credentials, cache };
}

describe('TokenValidityService — user tokens', () => {
  it('accepts a live session whose user is active', async () => {
    const { service } = make();
    await expect(service.assertLive(userClaims)).resolves.toBeUndefined();
  });

  // The four consequences from the issue, one test each.

  it('rejects a revoked session (logout / logout-all / password change)', async () => {
    // `findLiveById` filters revoked rows out, so a revoked session reads as absent.
    const { service } = make({ session: null });
    await expect(service.assertLive(userClaims)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  // `SessionRepository.findLiveById` joins users and requires the owner to still
  // be live, so a soft-deleted account reads as "no live session" in one query
  // rather than needing a second round trip.
  it('rejects a token whose user has been soft-deleted', async () => {
    const { service } = make({ session: null });
    await expect(service.assertLive(userClaims)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('rejects a user token carrying no session id', async () => {
    // Every token issued before this change. Fail closed rather than grandfather
    // in exactly the unrevocable tokens the change exists to eliminate.
    const { service, sessions } = make();
    await expect(
      service.assertLive({ ...userClaims, sid: undefined }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_TOKEN_INVALID });
    expect(sessions.findLiveById).not.toHaveBeenCalled();
  });
});

describe('TokenValidityService — service tokens', () => {
  it('accepts a live credential', async () => {
    const { service } = make();
    await expect(service.assertLive(serviceClaims)).resolves.toBeUndefined();
  });

  it('rejects a revoked or deleted credential', async () => {
    const { service } = make({ credential: null });
    await expect(service.assertLive(serviceClaims)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('rejects an expired credential', async () => {
    const { service } = make({
      credential: { id: 'cred-1', expiresAt: past() },
    });
    await expect(service.assertLive(serviceClaims)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('accepts a credential whose expiry is still ahead', async () => {
    const { service } = make({
      credential: { id: 'cred-1', expiresAt: future() },
    });
    await expect(service.assertLive(serviceClaims)).resolves.toBeUndefined();
  });

  it('does not look for a session', async () => {
    const { service, sessions } = make();
    await service.assertLive(serviceClaims);
    expect(sessions.findLiveById).not.toHaveBeenCalled();
  });
});

describe('TokenValidityService — caching', () => {
  it('reads the database on a miss and caches the verdict', async () => {
    const { service, sessions, cache } = make();
    await service.assertLive(userClaims);
    expect(sessions.findLiveById).toHaveBeenCalledWith('sess-1');
    expect(cache.set).toHaveBeenCalledWith(
      'user:sess-1',
      { live: true },
      expect.any(Number),
    );
  });

  it('serves a cached positive without touching the database', async () => {
    const { service, sessions, credentials } = make({
      cache: { get: jest.fn(async () => ({ live: true })) },
    });
    await expect(service.assertLive(userClaims)).resolves.toBeUndefined();
    expect(sessions.findLiveById).not.toHaveBeenCalled();
    expect(credentials.findLiveById).not.toHaveBeenCalled();
  });

  // Negative caching matters: a revoked token is exactly the one an attacker
  // retries. Without it every replay is a fresh pair of database reads.
  it('serves a cached negative without touching the database', async () => {
    const { service, sessions } = make({
      cache: { get: jest.fn(async () => ({ live: false })) },
    });
    await expect(service.assertLive(userClaims)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
    expect(sessions.findLiveById).not.toHaveBeenCalled();
  });

  it('caches a negative verdict so a replayed dead token stays cheap', async () => {
    const { service, cache } = make({ session: null });
    await expect(service.assertLive(userClaims)).rejects.toBeDefined();
    expect(cache.set).toHaveBeenCalledWith(
      'user:sess-1',
      { live: false },
      expect.any(Number),
    );
  });
});

describe('TokenValidityService — fails closed when Redis is unreachable', () => {
  it('rejects with 503 when the cache read errors', async () => {
    const { service, sessions } = make({
      cache: {
        get: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      },
    });
    await expect(service.assertLive(userClaims)).rejects.toMatchObject({
      code: ErrorCode.CACHE_UNAVAILABLE,
    });
    // Fail closed means closed: no silent fallback to the database.
    expect(sessions.findLiveById).not.toHaveBeenCalled();
  });

  it('rejects with 503 when the cache read times out', async () => {
    const { service } = make({
      cache: {
        get: jest.fn(async () => {
          throw new TimeoutError(200);
        }),
      },
    });
    await expect(service.assertLive(userClaims)).rejects.toMatchObject({
      code: ErrorCode.CACHE_UNAVAILABLE,
    });
  });

  // 503, not 401: the token may be perfectly valid — we cannot say. Telling an
  // honest client to re-authenticate would stampede argon2 hashing on the login
  // path at the exact moment Redis is already struggling.
  it('does not report a cache outage as an invalid token', async () => {
    const { service } = make({
      cache: {
        get: jest.fn(async () => {
          throw new Error('down');
        }),
      },
    });
    await expect(service.assertLive(userClaims)).rejects.not.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('does not fail the request when only the cache WRITE fails', async () => {
    // The verdict is already known from the database at this point; failing here
    // would turn a cache hiccup into a rejected, legitimately-authenticated call.
    const { service } = make({
      cache: {
        set: jest.fn(async () => {
          throw new Error('write failed');
        }),
      },
    });
    await expect(service.assertLive(userClaims)).resolves.toBeUndefined();
  });
});
