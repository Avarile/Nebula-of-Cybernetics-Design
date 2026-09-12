import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { MailerService } from '../src/infrastructure/email/mailer.service';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

/** In-memory MailerService replacement that records every message. */
class FakeMailer {
  sent: { to: string; subject: string; text: string; html?: string }[] = [];
  async send(msg: any) {
    this.sent.push(msg);
  }
  async verifyActive() {
    /* no-op */
  }
  lastCodeFor(to: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.to === to) {
        const match = m.text.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    return null;
  }
}

/**
 * Password-reset HTTP contract e2e. Boots ConfigModule + DatabaseModule +
 * AuthModule + UsersModule + ThrottlerModule and registers the global guards,
 * mirroring auth.e2e-spec.ts, so this avoids MastraModule's ESM-only
 * dependency. MailerService is overridden with an in-memory FakeMailer so the
 * test can read the generated reset code straight off the captured email.
 * Requires Postgres (schema migrated) + Redis. Run with
 * `pnpm test:e2e -- password-reset.e2e`.
 */
function buildModule(mailer: FakeMailer) {
  return Test.createTestingModule({
    imports: [
      ConfigModule,
      DatabaseModule,
      ExceptionsModule,
      LoggerModule,
      ThrottlerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (c: ConfigService) => {
          const a = c.getOrThrow<AuthConfig>('auth');
          return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }]; // high, avoid flakiness
        },
      }),
      AuthModule,
      UsersModule,
    ],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();
}

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let mailer: FakeMailer;
  const stamp = String(Date.now());
  const userAEmail = `reset_a_${stamp}@e2e.local`;
  const userBEmail = `reset_b_${stamp}@e2e.local`;
  const oldPass = 'old-e2e-password-123';
  const newPass = 'new-e2e-password-456';
  let userARefresh: string;

  beforeAll(async () => {
    mailer = new FakeMailer();
    const moduleRef = await buildModule(mailer);
    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: userAEmail, password: oldPass, role: 'user' });
    await users.create({ email: userBEmail, password: oldPass, role: 'user' });

    // Log userA in first to obtain a refresh token that reset must revoke.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userAEmail, password: oldPass })
      .expect(200);
    userARefresh = login.body.refreshToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  // forgot-password call #1
  it('completes the happy path: forgot → reset → login with new password', async () => {
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: userAEmail })
      .expect(204);

    const code = mailer.lastCodeFor(userAEmail);
    expect(code).toMatch(/^\d{6}$/);

    await request(server())
      .post('/auth/reset-password')
      .send({ email: userAEmail, code, newPassword: newPass })
      .expect(204);

    // New password works.
    await request(server())
      .post('/auth/login')
      .send({ email: userAEmail, password: newPass })
      .expect(200);

    // Old password no longer works.
    await request(server())
      .post('/auth/login')
      .send({ email: userAEmail, password: oldPass })
      .expect(401);

    // The pre-reset refresh token was revoked (all sessions killed).
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: userARefresh })
      .expect(401);

    // A confirmation email was sent.
    expect(
      mailer.sent.some(
        (m) => m.to === userAEmail && /changed/i.test(m.subject),
      ),
    ).toBe(true);
  });

  // forgot-password call #2
  it('returns 204 for an unknown email and sends no mail', async () => {
    const before = mailer.sent.length;
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: `ghost_${stamp}@e2e.local` })
      .expect(204);
    expect(mailer.sent.length).toBe(before);
  });

  // forgot-password call #3
  it('locks out after 5 wrong codes and burns the code', async () => {
    await request(server())
      .post('/auth/forgot-password')
      .send({ email: userBEmail })
      .expect(204);
    const realCode = mailer.lastCodeFor(userBEmail);
    expect(realCode).toMatch(/^\d{6}$/);

    // A deliberately wrong 6-digit code (differs from the real one).
    const wrong = realCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(server())
        .post('/auth/reset-password')
        .send({ email: userBEmail, code: wrong, newPassword: newPass })
        .expect(401);
    }

    // The correct code is now burned → still 401.
    await request(server())
      .post('/auth/reset-password')
      .send({ email: userBEmail, code: realCode, newPassword: newPass })
      .expect(401);

    // userB's original password is unchanged.
    await request(server())
      .post('/auth/login')
      .send({ email: userBEmail, password: oldPass })
      .expect(200);
  });

  it('rejects malformed input with 400 (validation, pre-lookup)', async () => {
    await request(server())
      .post('/auth/reset-password')
      .send({ email: userAEmail, code: '12', newPassword: 'short' })
      .expect(400);
  });
});

describe('Password reset throttling (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await buildModule(new FakeMailer());
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('throttles forgot-password after 3 requests (429 on the 4th)', async () => {
    const email = `throttle_${Date.now()}@e2e.local`;
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(204);
    }
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(429);
  });
});
