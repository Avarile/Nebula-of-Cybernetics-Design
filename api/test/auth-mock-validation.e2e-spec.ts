import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Pool } from 'pg';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { PG_POOL } from '../src/infrastructure/database/drizzle.constants';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

/**
 * Mock-account validation harness. Provisions several distinct accounts and
 * drives the full auth/authz lifecycle against the live DB (Postgres + Redis
 * per .env). Every account/credential created here is prefixed with the run
 * stamp and hard-deleted in afterAll, so the harness leaves no residue.
 * Includes ExceptionsModule so UsersService/AuthService (which throw via
 * ExceptionService) can resolve their dependency, and LoggerModule since
 * GlobalExceptionFilter injects nestjs-pino's PinoLogger.
 *
 * Run: pnpm test:e2e -- auth-mock-validation
 */
const STAMP = String(Date.now());
const DOMAIN = `${STAMP}.validate.local`;
const email = (local: string) => `mock_${local}@${DOMAIN}`;
const STRONG = 'Sup3r-Secret-Pass!'; // >= 12 chars, satisfies all DTOs

/** Boots the same module subset as auth.e2e, optionally with the throttler. */
async function boot(withThrottler: boolean): Promise<INestApplication> {
  const providers = [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ];
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      DatabaseModule,
      ExceptionsModule,
      LoggerModule,
      ThrottlerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (c: ConfigService) => {
          const a = c.getOrThrow<AuthConfig>('auth');
          // Lifecycle app: effectively unlimited. Throttle app: real per-route caps.
          return [
            {
              ttl: a.throttleTtl * 1000,
              limit: withThrottler ? 100 : 1_000_000,
            },
          ];
        },
      }),
      AuthModule,
      UsersModule,
    ],
    providers: withThrottler
      ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }, ...providers]
      : providers,
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function cleanup(app: INestApplication): Promise<void> {
  const pool = app.get<Pool>(PG_POOL);
  // service_credentials.created_by → users(id) has no cascade; delete creds first.
  await pool.query(`DELETE FROM service_credentials WHERE name LIKE $1`, [
    `mock-%-${STAMP}`,
  ]);
  // sessions cascade on user delete.
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [
    `mock_%@${DOMAIN}`,
  ]);
}

describe('Auth mock-account validation (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  // Mock accounts provisioned for this run.
  const admin = { email: email('admin'), pass: STRONG, access: '' };
  const alice = {
    email: email('alice'),
    pass: STRONG,
    access: '',
    refresh: '',
  };
  const bob = {
    email: email('bob'),
    pass: STRONG,
    newPass: 'Rotated-Pass-9876!',
    access: '',
    refresh: '',
  };
  const carol = {
    email: email('carol_admin'),
    pass: STRONG,
    access: '',
    refresh: '',
  };
  const dave = { email: email('dave'), pass: STRONG, id: '' };

  beforeAll(async () => {
    app = await boot(false);
    // Bootstrap the first admin directly (bypasses the admin-only guard).
    await app.get(UsersService).create({
      email: admin.email,
      password: admin.pass,
      role: 'admin',
    });
  });

  afterAll(async () => {
    if (app) {
      await cleanup(app);
      await app.close();
    }
  });

  const login = (e: string, p: string) =>
    request(server()).post('/auth/login').send({ email: e, password: p });

  // ── Bootstrap admin ──────────────────────────────────────────────────────
  it('admin logs in and receives a token pair', async () => {
    const res = await login(admin.email, admin.pass).expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.expiresIn).toBeGreaterThan(0);
    admin.access = res.body.accessToken;
  });

  // ── Admin provisions several mock accounts ─────────────────────────────────
  it('admin provisions 3 mock accounts (2 users + 1 admin)', async () => {
    for (const [acct, role, name] of [
      [alice, 'user', 'Alice'],
      [bob, 'user', 'Bob'],
      [carol, 'admin', 'Carol'],
    ] as const) {
      const res = await request(server())
        .post('/users')
        .set('Authorization', `Bearer ${admin.access}`)
        .send({
          email: acct.email,
          password: acct.pass,
          role,
          displayName: name,
        })
        .expect(201);
      expect(res.body.role).toBe(role);
      expect(res.body.passwordHash).toBeUndefined(); // never leak the hash
      expect(res.body.id).toBeDefined();
    }
  });

  it('rejects a duplicate email with 409', async () => {
    await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ email: alice.email, password: STRONG, role: 'user' })
      .expect(409);
  });

  it('rejects a weak (<12 char) password with 400', async () => {
    await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ email: email('weak'), password: 'short', role: 'user' })
      .expect(400);
  });

  // ── Each mock account logs in ──────────────────────────────────────────────
  it('every provisioned account can log in', async () => {
    for (const acct of [alice, bob, carol]) {
      const res = await login(acct.email, acct.pass).expect(200);
      (acct as { access: string }).access = res.body.accessToken;
      (acct as { refresh: string }).refresh = res.body.refreshToken;
    }
  });

  it('/auth/me resolves the correct principal + role for each', async () => {
    const cases: Array<[typeof alice | typeof carol, string]> = [
      [alice, 'user'],
      [carol, 'admin'],
    ];
    for (const [acct, role] of cases) {
      const res = await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${acct.access}`)
        .expect(200);
      expect(res.body.role).toBe(role);
      expect(res.body.id).toBeTruthy();
    }
  });

  // ── Authentication negatives (uniform 401) ─────────────────────────────────
  it('rejects wrong password, unknown email, and non-string credentials with 401', async () => {
    await login(alice.email, 'wrong-password-xx').expect(401);
    await login(email('ghost'), STRONG).expect(401);
    // Non-string password must not bypass verification (guards typeof check).
    await request(server())
      .post('/auth/login')
      .send({ email: alice.email, password: 12345 })
      .expect(401);
  });

  // ── Authorization (RolesGuard) ─────────────────────────────────────────────
  it('enforces authorization on the admin-only /users route', async () => {
    await request(server()).get('/users').expect(401); // no token
    await request(server())
      .get('/users')
      .set('Authorization', `Bearer ${alice.access}`)
      .expect(403); // authenticated but role=user
    const ok = await request(server())
      .get('/users')
      .set('Authorization', `Bearer ${carol.access}`)
      .expect(200); // role=admin
    expect(Array.isArray(ok.body.data)).toBe(true);
    expect(ok.body.total).toBeGreaterThan(0);
  });

  // ── Refresh rotation + theft (family) detection ────────────────────────────
  it('rotates the refresh token and revokes the family on reuse', async () => {
    const r1 = alice.refresh;
    const rotated = await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: r1 })
      .expect(200);
    const r2 = rotated.body.refreshToken;
    expect(r2).not.toBe(r1);

    // Replaying the now-revoked r1 => reuse detected, whole family revoked.
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: r1 })
      .expect(401);
    // r2 belonged to the same family => also dead now.
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: r2 })
      .expect(401);
  });

  // ── Password change revokes sessions ───────────────────────────────────────
  it('changing password revokes sessions and swaps the valid credential', async () => {
    await request(server())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${bob.access}`)
      .send({ currentPassword: bob.pass, newPassword: bob.newPass })
      .expect(204);

    // Old refresh token is revoked by the change.
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: bob.refresh })
      .expect(401);
    // Old password no longer works; new one does.
    await login(bob.email, bob.pass).expect(401);
    await login(bob.email, bob.newPass).expect(200);
  });

  it('rejects a password change with the wrong current password', async () => {
    await request(server())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${carol.access}`)
      .send({
        currentPassword: 'not-my-password',
        newPassword: 'Another-Pass-123!',
      })
      .expect(401);
  });

  // ── Logout invalidates the refresh token ───────────────────────────────────
  it('logout invalidates the refresh token', async () => {
    const res = await login(carol.email, carol.pass).expect(200);
    await request(server())
      .post('/auth/logout')
      .send({ refreshToken: res.body.refreshToken })
      .expect(204);
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: res.body.refreshToken })
      .expect(401);
  });

  // ── logout-all revokes every session (and /auth/sessions reflects it) ──────
  it('logout-all revokes all sessions for the user', async () => {
    const erin = email('erin');
    await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ email: erin, password: STRONG, role: 'user' })
      .expect(201);

    // Two independent logins => two live sessions / refresh tokens.
    const s1 = await login(erin, STRONG).expect(200);
    const s2 = await login(erin, STRONG).expect(200);
    expect(s2.body.refreshToken).not.toBe(s1.body.refreshToken);

    // /auth/sessions lists both active sessions (never exposing the hash).
    const before = await request(server())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${s1.body.accessToken}`)
      .expect(200);
    expect(before.body.length).toBe(2);
    expect(before.body[0].tokenHash).toBeUndefined();

    // Revoke every session for this user in one call.
    await request(server())
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${s1.body.accessToken}`)
      .expect(204);

    // Both refresh tokens are now dead...
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: s1.body.refreshToken })
      .expect(401);
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: s2.body.refreshToken })
      .expect(401);

    // ...and so is the access token. This assertion used to read the other way,
    // with a comment explaining that "stateless JWT revocation bites at refresh
    // time, not mid-TTL" — which was A-2 exactly: `logout-all` was advisory for
    // the remaining access TTL. Access tokens are now bound to their session,
    // so revoking the session kills the token with it.
    await request(server())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${s1.body.accessToken}`)
      .expect(401);

    // A fresh login is the only way back in, and it starts from a clean slate.
    const revived = await login(erin, STRONG).expect(200);
    const after = await request(server())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${revived.body.accessToken}`)
      .expect(200);
    expect(after.body.length).toBe(1);
  });

  // ── Service credential (agent) lifecycle ───────────────────────────────────
  it('issues, exchanges, and revokes an agent service credential', async () => {
    const created = await request(server())
      .post('/service-credentials')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ name: `mock-agent-${STAMP}` })
      .expect(201);
    expect(created.body.apiKey).toMatch(/^svc_/);
    const { apiKey, id } = created.body;

    const tok = await request(server())
      .post('/auth/service-token')
      .send({ apiKey })
      .expect(200);

    const me = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tok.body.accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('agent');

    // Listing never leaks the secret/hash.
    const list = await request(server())
      .get('/service-credentials')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    const row = list.body.find((c: { id: string }) => c.id === id);
    expect(row).toBeDefined();
    expect(row.keyHash).toBeUndefined();
    expect(row.apiKey).toBeUndefined();

    // Revoke => the key can no longer be exchanged.
    await request(server())
      .delete(`/service-credentials/${id}`)
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(204);
    await request(server())
      .post('/auth/service-token')
      .send({ apiKey })
      .expect(401);
  });

  // ── Soft-delete + re-registration (partial unique index) ───────────────────
  it('soft-deletes a user, blocks login, and allows re-registering the email', async () => {
    const created = await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ email: dave.email, password: dave.pass, role: 'user' })
      .expect(201);
    dave.id = created.body.id;

    await login(dave.email, dave.pass).expect(200); // works pre-delete

    await request(server())
      .delete(`/users/${dave.id}`)
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(204);

    await login(dave.email, dave.pass).expect(401); // soft-deleted => no login

    // Same email re-registers (partial unique index is WHERE is_deleted = false).
    await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ email: dave.email, password: dave.pass, role: 'user' })
      .expect(201);
  });
});

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const throttleUser = { email: email('throttle'), pass: STRONG };

  beforeAll(async () => {
    app = await boot(true); // throttler active with real per-route caps
    await app.get(UsersService).create({
      email: throttleUser.email,
      password: throttleUser.pass,
      role: 'user',
    });
  });

  afterAll(async () => {
    if (app) {
      await cleanup(app);
      await app.close();
    }
  });

  it('throttles login after the per-route limit (5/min) with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(server())
        .post('/auth/login')
        .send({ email: throttleUser.email, password: throttleUser.pass });
      codes.push(res.status);
    }
    // First 5 succeed, the rest are rate-limited.
    expect(codes.filter((c) => c === 200).length).toBe(5);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});
