import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { CacheModule } from '../src/infrastructure/cache/cache.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';

jest.setTimeout(60_000);

/**
 * Access-token revocation e2e.
 *
 * Every case here passed *before* the fix — that is the point. The token stayed
 * authoritative for its full TTL no matter what happened to the identity behind
 * it, so `logout-all`, a password change, a role change, a soft-delete and a
 * credential revocation were all advisory.
 *
 * Boots a focused module subset (never AppModule) to avoid the Mastra ESM/Jest
 * break. Requires Postgres + Redis. Run with `pnpm test:e2e -- token-revocation`.
 */
describe('Access token revocation (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const pass = 'revocation-e2e-password-123';
  const adminEmail = `revoke_admin_${stamp}@e2e.local`;
  const userEmail = `revoke_user_${stamp}@e2e.local`;
  let adminToken: string;

  const server = () => app.getHttpServer();
  const withToken = (r: request.Test, token: string) =>
    r.set('Authorization', `Bearer ${token}`);

  /** Logs the standard user in and returns a fresh token pair. */
  const login = async (email = userEmail) => {
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: pass })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };

  /** The canonical "is this token still accepted?" probe. */
  const meStatus = async (token: string) =>
    (await withToken(request(server()).get('/auth/me'), token)).status;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        CacheModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        // No ThrottlerGuard. `/auth/login` carries its own
        // `@Throttle({ limit: 5, ttl: 60s })`, which a raised global limit does
        // not override — and since A-3 moved throttle state into shared Redis,
        // the count persists across suites and across runs. This suite logs in
        // once per case, so it tripped the cap partway through and reported
        // revocation failures that were really 429s. Rate limiting has its own
        // coverage; here it is noise. (Overriding the guard does not work:
        // it is registered under the APP_GUARD token, not its own class.)
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: adminEmail, password: pass, role: 'admin' });
    await users.create({ email: userEmail, password: pass, role: 'user' });
    adminToken = (await login(adminEmail)).accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts a freshly issued token', async () => {
    const { accessToken } = await login();
    expect(await meStatus(accessToken)).toBe(200);
  });

  it('kills the access token on logout-all', async () => {
    const { accessToken } = await login();
    expect(await meStatus(accessToken)).toBe(200);

    await withToken(
      request(server()).post('/auth/logout-all'),
      accessToken,
    ).expect(204);

    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills the access token on logout of that session', async () => {
    const { accessToken, refreshToken } = await login();
    await request(server())
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(204);
    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills the access token when the user changes their password', async () => {
    const email = `revoke_pw_${stamp}@e2e.local`;
    await app.get(UsersService).create({ email, password: pass, role: 'user' });
    const { accessToken } = await login(email);

    await withToken(request(server()).patch('/auth/password'), accessToken)
      .send({ currentPassword: pass, newPassword: 'another-password-9876' })
      .expect(204);

    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills the access token when an admin resets the password', async () => {
    // Its own user, like the role-change and soft-delete cases below. This one
    // used to reset the password of the SHARED user, which left every later
    // bare `login()` authenticating with credentials the suite had just
    // invalidated — a 401 that looked like a revocation failure.
    const email = `revoke_admin_pw_${stamp}@e2e.local`;
    const target = await app
      .get(UsersService)
      .create({ email, password: pass, role: 'user' });
    const { accessToken } = await login(email);

    await withToken(request(server()).patch(`/users/${target.id}`), adminToken)
      .send({ password: 'admin-set-password-4321' })
      .expect(200);
    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills the access token when an admin changes the role', async () => {
    const email = `revoke_role_${stamp}@e2e.local`;
    const target = await app
      .get(UsersService)
      .create({ email, password: pass, role: 'user' });
    const { accessToken } = await login(email);

    await withToken(request(server()).patch(`/users/${target.id}`), adminToken)
      .send({ role: 'admin' })
      .expect(200);

    // A role is a signed claim, so a promotion or demotion is invisible until a
    // new token is minted — which is why the change forces re-authentication.
    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills the access token when the user is soft-deleted', async () => {
    const email = `revoke_del_${stamp}@e2e.local`;
    const target = await app
      .get(UsersService)
      .create({ email, password: pass, role: 'user' });
    const { accessToken } = await login(email);

    await withToken(
      request(server()).delete(`/users/${target.id}`),
      adminToken,
    ).expect(204);

    expect(await meStatus(accessToken)).toBe(401);
  });

  it('kills a service token when its credential is revoked', async () => {
    const issued = await withToken(
      request(server()).post('/service-credentials'),
      adminToken,
    )
      .send({ name: `revoke-cred-${stamp}` })
      .expect(201);

    const exchanged = await request(server())
      .post('/auth/service-token')
      .send({ apiKey: issued.body.apiKey })
      .expect(200);
    const agentToken = exchanged.body.accessToken as string;
    expect(await meStatus(agentToken)).toBe(200);

    await withToken(
      request(server()).delete(`/service-credentials/${issued.body.id}`),
      adminToken,
    ).expect(204);

    expect(await meStatus(agentToken)).toBe(401);
  });

  it('kills the pre-rotation access token when the refresh token is rotated', async () => {
    const { accessToken, refreshToken } = await login();
    const rotated = await request(server())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // Deliberate: rotation revokes the old session, so its access token dies
    // with it rather than lingering for the rest of its TTL.
    expect(await meStatus(accessToken)).toBe(401);
    expect(await meStatus(rotated.body.accessToken)).toBe(200);
  });

  it('leaves other sessions alone when one is revoked', async () => {
    const first = await login();
    const second = await login();

    await request(server())
      .post('/auth/logout')
      .send({ refreshToken: first.refreshToken })
      .expect(204);

    expect(await meStatus(first.accessToken)).toBe(401);
    expect(await meStatus(second.accessToken)).toBe(200);
  });
});
