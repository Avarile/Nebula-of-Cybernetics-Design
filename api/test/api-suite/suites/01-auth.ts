import type { Ctx } from '../harness/context';

/**
 * The authentication contract, exercised against both principals.
 *
 * Two things get their own throwaway user rather than reusing the mock user:
 * `PATCH /auth/password` and `POST /auth/logout-all` both revoke every session
 * for the account, which would invalidate the token the remaining fifteen
 * suites are holding.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const admin = client.principal('admin');
  const user = client.principal('user');

  // ---------------------------------------------------------------- identity

  await client.call({
    name: 'admin reads its own profile',
    method: 'GET',
    path: '/auth/me',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      if (b?.role !== 'admin') return `role was ${b?.role}`;
      if (b?.email !== admin.email) return `email was ${b?.email}`;
      if ('passwordHash' in (b ?? {})) return 'response leaked passwordHash';
      return undefined;
    },
  });

  await client.call({
    name: 'mock user reads its own profile',
    method: 'GET',
    path: '/auth/me',
    actor: 'user',
    expect: 200,
    assert: (b) =>
      b?.id === user.userId
        ? undefined
        : `id was ${b?.id}, wanted ${user.userId}`,
  });

  await client.call({
    name: 'profile requires a token',
    method: 'GET',
    path: '/auth/me',
    actor: 'anon',
    expect: 401,
  });

  await client.call({
    name: 'a malformed bearer token is rejected',
    method: 'GET',
    path: '/auth/me',
    actor: 'raw',
    token: 'not.a.jwt',
    expect: 401,
  });

  await client.call({
    name: 'a token signed by nobody is rejected',
    method: 'GET',
    path: '/auth/me',
    actor: 'raw',
    token: forgedJwt(user.userId),
    expect: 401,
  });

  // ---------------------------------------------------------------- sessions

  await client.call({
    name: 'user lists its active sessions',
    method: 'GET',
    path: '/auth/sessions',
    actor: 'user',
    expect: 200,
    assert: (b) => {
      if (!Array.isArray(b)) return 'expected an array';
      if (b.length < 1) return 'expected at least the current session';
      if (b.some((s: any) => 'tokenHash' in s || 'refreshToken' in s)) {
        return 'session summary leaked token material';
      }
      return undefined;
    },
  });

  // ----------------------------------------------------------------- refresh

  // Rotation and reuse-detection are tested on their own short-lived session.
  // Replaying a rotated-out refresh token is treated as theft and revokes the
  // whole token family — correct, and fatal to any session the remaining
  // suites still need. So this borrows a second login rather than the one the
  // rest of the run is holding.
  const rotation = await client.call({
    name: 'the mock user opens a second session for rotation tests',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: { email: user.email, password: user.password },
    expect: 200,
  });

  if (rotation.ok) {
    const refreshed = await client.call({
      name: 'refresh exchanges a refresh token for a new pair',
      method: 'POST',
      path: '/auth/refresh',
      actor: 'anon',
      body: { refreshToken: rotation.body.refreshToken },
      expect: 200,
      assert: (b) => {
        if (!b?.accessToken || !b?.refreshToken) return 'missing token pair';
        if (b.refreshToken === rotation.body.refreshToken) {
          return 'the refresh token was not rotated';
        }
        return undefined;
      },
    });

    if (refreshed.ok) {
      await client.call({
        name: 'the rotated access token authenticates',
        method: 'GET',
        path: '/auth/me',
        actor: 'raw',
        token: refreshed.body.accessToken,
        expect: 200,
      });

      await client.call({
        name: 'replaying the rotated-out refresh token is refused',
        method: 'POST',
        path: '/auth/refresh',
        actor: 'anon',
        body: { refreshToken: rotation.body.refreshToken },
        expect: [401, 403],
      });

      // Reuse is read as theft, so the entire family — including the pair that
      // was legitimately rotated to — must now be dead.
      await client.call({
        name: 'reuse detection revokes the whole token family',
        method: 'POST',
        path: '/auth/refresh',
        actor: 'anon',
        body: { refreshToken: refreshed.body.refreshToken },
        expect: [401, 403],
      });

      await client.call({
        name: 'the mock user’s other session is untouched by that revocation',
        method: 'GET',
        path: '/auth/me',
        actor: 'user',
        expect: 200,
      });
    }
  }

  await client.call({
    name: 'refresh rejects a garbage token',
    method: 'POST',
    path: '/auth/refresh',
    actor: 'anon',
    body: { refreshToken: 'nonsense-token-value' },
    expect: [401, 403],
  });

  // ------------------------------------------------ password + logout (throwaway)

  const throwaway = {
    email: `apisuite.throwaway.${stamp}@cybernetics.test`,
    password: 'Throwaway-Password-1!',
  };

  const created = await client.call({
    name: 'admin provisions a throwaway account for destructive auth checks',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: { ...throwaway, role: 'user', displayName: 'Throwaway Auth Probe' },
    expect: 201,
  });

  if (created.ok) {
    const login = await client.call({
      name: 'the throwaway account can log in',
      method: 'POST',
      path: '/auth/login',
      actor: 'anon',
      body: throwaway,
      expect: 200,
    });

    if (login.ok) {
      const token = login.body.accessToken as string;

      await client.call({
        name: 'password change rejects the wrong current password',
        method: 'PATCH',
        path: '/auth/password',
        actor: 'raw',
        token,
        body: {
          currentPassword: 'definitely-not-it',
          newPassword: 'Another-Password-2!',
        },
        expect: 401,
      });

      await client.call({
        name: 'password change enforces the 12-character minimum',
        method: 'PATCH',
        path: '/auth/password',
        actor: 'raw',
        token,
        body: { currentPassword: throwaway.password, newPassword: 'short' },
        expect: 400,
      });

      await client.call({
        name: 'password change succeeds with the correct current password',
        method: 'PATCH',
        path: '/auth/password',
        actor: 'raw',
        token,
        body: {
          currentPassword: throwaway.password,
          newPassword: 'Throwaway-Password-2!',
        },
        expect: 204,
      });

      await client.call({
        name: 'changing the password revokes every existing session',
        method: 'GET',
        path: '/auth/me',
        actor: 'raw',
        token,
        expect: 401,
      });

      const reLogin = await client.call({
        name: 'the new password works',
        method: 'POST',
        path: '/auth/login',
        actor: 'anon',
        body: { email: throwaway.email, password: 'Throwaway-Password-2!' },
        expect: 200,
      });

      // logout-all runs first: it revokes every session including this one, so
      // anything that needs a live token has to happen before it, not after.
      if (reLogin.ok) {
        await client.call({
          name: 'logout-all revokes every session for the account',
          method: 'POST',
          path: '/auth/logout-all',
          actor: 'raw',
          token: reLogin.body.accessToken,
          expect: 204,
        });

        await client.call({
          name: 'the access token is dead after logout-all',
          method: 'GET',
          path: '/auth/me',
          actor: 'raw',
          token: reLogin.body.accessToken,
          expect: 401,
        });

        await client.call({
          name: 'the refresh token is dead after logout-all',
          method: 'POST',
          path: '/auth/refresh',
          actor: 'anon',
          body: { refreshToken: reLogin.body.refreshToken },
          expect: [401, 403],
        });
      }

      // A fresh session, purely so single-session logout has something to
      // revoke that logout-all has not already taken.
      const finalLogin = await client.call({
        name: 'the throwaway account logs in once more',
        method: 'POST',
        path: '/auth/login',
        actor: 'anon',
        body: { email: throwaway.email, password: 'Throwaway-Password-2!' },
        expect: 200,
      });

      if (finalLogin.ok) {
        await client.call({
          name: 'logout revokes the refresh token it is given',
          method: 'POST',
          path: '/auth/logout',
          actor: 'anon',
          body: { refreshToken: finalLogin.body.refreshToken },
          expect: 204,
        });

        await client.call({
          name: 'the logged-out refresh token cannot be reused',
          method: 'POST',
          path: '/auth/refresh',
          actor: 'anon',
          body: { refreshToken: finalLogin.body.refreshToken },
          expect: [401, 403],
        });
      }
    }

    await client.call({
      name: 'admin removes the throwaway account',
      method: 'DELETE',
      path: '/users/{id}',
      params: { id: created.body.id },
      actor: 'admin',
      expect: 204,
    });
  }

  // ---------------------------------------------------------- login negatives

  await client.call({
    name: 'login rejects a wrong password',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: { email: user.email, password: 'wrong-password-entirely' },
    expect: 401,
    assert: (b) =>
      /not found|no such user/i.test(b?.error?.message ?? '')
        ? 'error message distinguishes unknown user from wrong password'
        : undefined,
  });

  await client.call({
    name: 'login rejects an unknown address with the same answer',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: {
      email: `nobody.${stamp}@cybernetics.test`,
      password: 'whatever-123',
    },
    expect: 401,
  });

  // The LocalAuthGuard runs ahead of the global validation pipe, so a
  // malformed body is rejected as "unauthorized" rather than "invalid". Either
  // is a defensible contract; what matters is that it never reaches the
  // credential check.
  await client.call({
    name: 'login refuses a malformed body',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: { email: 'not-an-email', password: '' },
    expect: [400, 401],
  });

  // ---------------------------------------------------------- password reset

  await client.call({
    name: 'forgot-password accepts a known address',
    method: 'POST',
    path: '/auth/forgot-password',
    actor: 'anon',
    body: { email: user.email },
    expect: 204,
  });

  await client.call({
    name: 'forgot-password does not enumerate unknown addresses',
    method: 'POST',
    path: '/auth/forgot-password',
    actor: 'anon',
    body: { email: `ghost.${stamp}@cybernetics.test` },
    expect: 204,
  });

  await client.call({
    name: 'reset-password rejects an invalid code',
    method: 'POST',
    path: '/auth/reset-password',
    actor: 'anon',
    body: {
      email: user.email,
      code: '000000',
      newPassword: 'Rejected-Password-9!',
    },
    expect: [400, 401, 403, 404, 422],
  });

  await client.call({
    name: 'reset-password enforces the six-digit code shape',
    method: 'POST',
    path: '/auth/reset-password',
    actor: 'anon',
    body: {
      email: user.email,
      code: 'abcdef',
      newPassword: 'Rejected-Password-9!',
    },
    expect: 400,
  });

  // ----------------------------------------------------- service credentials

  const cred = await client.call({
    name: 'admin issues a service credential',
    method: 'POST',
    path: '/service-credentials',
    actor: 'admin',
    body: { name: `api-suite-${stamp}` },
    expect: 201,
    assert: (b) =>
      b?.apiKey ? undefined : 'creation did not return the plaintext key',
  });

  if (cred.ok) {
    ctx.ids.serviceCredentialId = cred.body.id;
    ctx.ids.serviceApiKey = cred.body.apiKey;
  }

  await client.call({
    name: 'a standard user cannot issue service credentials',
    method: 'POST',
    path: '/service-credentials',
    actor: 'user',
    body: { name: `should-not-exist-${stamp}` },
    expect: 403,
  });

  await client.call({
    name: 'admin lists service credentials without exposing key material',
    method: 'GET',
    path: '/service-credentials',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      if (!Array.isArray(b)) return 'expected an array';
      const leaky = b.find((c: any) => c.apiKey || c.keyHash);
      return leaky ? 'listing exposed key material' : undefined;
    },
  });

  if (ctx.ids.serviceApiKey) {
    const exchanged = await client.call({
      name: 'a service key exchanges for an agent access token',
      method: 'POST',
      path: '/auth/service-token',
      actor: 'anon',
      body: { apiKey: ctx.ids.serviceApiKey },
      expect: 200,
      assert: (b) => (b?.accessToken ? undefined : 'no access token returned'),
    });

    if (exchanged.ok) {
      const claims = decodeClaims(exchanged.body.accessToken);
      client.assert(
        'the exchanged token carries the agent role',
        'POST',
        '/auth/service-token',
        claims?.role === 'agent' ? undefined : `role claim was ${claims?.role}`,
      );

      ctx.facts.agentToken = exchanged.body.accessToken;
      // A service token has no refresh token; it is renewed by exchanging the
      // API key again, which is what a real machine caller would do.
      const apiKey = ctx.ids.serviceApiKey;
      const baseUrl = ctx.baseUrl;
      client.setPrincipal('agent', {
        email: 'service@credential',
        password: '',
        userId: claims?.sub ?? '',
        accessToken: exchanged.body.accessToken,
        refreshToken: '',
        role: 'agent',
        renew: async () => {
          const res = await fetch(`${baseUrl}/auth/service-token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey }),
          });
          if (!res.ok) return null;
          const body = (await res.json()) as { accessToken?: string };
          return body.accessToken ? { accessToken: body.accessToken } : null;
        },
      });

      await client.call({
        name: 'the agent token reaches an agent-allowed route',
        method: 'GET',
        path: '/auth/me',
        actor: 'agent',
        expect: 200,
        assert: (b) =>
          b?.role === 'agent' ? undefined : `role was ${b?.role}`,
      });

      await client.call({
        name: 'the agent token is refused on a user-only route',
        method: 'GET',
        path: '/auth/sessions',
        actor: 'agent',
        expect: 403,
      });
    }
  }

  await client.call({
    name: 'service-token rejects an unknown key',
    method: 'POST',
    path: '/auth/service-token',
    actor: 'anon',
    body: { apiKey: 'sk_not_a_real_key_at_all' },
    expect: [401, 403],
  });
}

/** A structurally valid JWT signed with the wrong key — must not authenticate. */
function forgedJwt(sub: string): string {
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const payload = enc({
    sub,
    role: 'admin',
    kind: 'user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.${Buffer.from('forged').toString('base64url')}`;
}

function decodeClaims(token: string): Record<string, any> | undefined {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  } catch {
    return undefined;
  }
}
