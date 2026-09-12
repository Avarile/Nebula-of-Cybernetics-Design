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
import { SystemModule } from '../src/features/system/system.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

/**
 * System-records HTTP contract e2e. Requires Postgres (migrated) + Redis.
 * Includes ExceptionsModule so UsersService/AuthService/SystemModule services
 * (which throw via ExceptionService) can resolve their dependency, and
 * LoggerModule since GlobalExceptionFilter injects nestjs-pino's PinoLogger.
 * Run with `pnpm test:e2e -- system.e2e`.
 */
describe('System Records API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const adminEmail = `sys_admin_${stamp}@e2e.local`;
  const adminPass = 'sys-admin-e2e-password-123';
  const userEmail = `sys_user_${stamp}@e2e.local`;
  const userPass = 'sys-user-e2e-password-123';
  let adminAccess: string;
  let userAccess: string;

  beforeAll(async () => {
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
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SystemModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({
      email: adminEmail,
      password: adminPass,
      role: 'admin',
    });
    await users.create({ email: userEmail, password: userPass, role: 'user' });

    adminAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPass })
        .expect(200)
    ).body.accessToken;
    userAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: userPass })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${adminAccess}`);

  it('rejects unauthenticated access', async () => {
    await request(server()).get('/system/smtp').expect(401);
  });

  it('forbids a non-admin', async () => {
    await request(server())
      .get('/system/smtp')
      .set('Authorization', `Bearer ${userAccess}`)
      .expect(403);
  });

  it('creates an SMTP config and never returns the secret', async () => {
    const res = await asAdmin(request(server()).post('/system/smtp'))
      .send({
        name: 'Primary',
        host: 'smtp.example.com',
        port: 587,
        username: 'mailer',
        secret: 'super-secret-pass',
        secure: true,
        fromAddress: 'no-reply@example.com',
      })
      .expect(201);
    expect(res.body.hasSecret).toBe(true);
    expect(res.body.secret).toBeUndefined();
    expect(res.body.secretEnc).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
  });

  it('enforces a single active SMTP config', async () => {
    const mk = async (name: string) =>
      (
        await asAdmin(request(server()).post('/system/smtp'))
          .send({
            name,
            host: 'smtp.example.com',
            port: 587,
            secure: true,
            fromAddress: 'no-reply@example.com',
          })
          .expect(201)
      ).body.id;
    const a = await mk(`A_${stamp}`);
    const b = await mk(`B_${stamp}`);

    await asAdmin(request(server()).post(`/system/smtp/${a}/activate`)).expect(
      201,
    );
    await asAdmin(request(server()).post(`/system/smtp/${b}/activate`)).expect(
      201,
    );

    const list = (
      await asAdmin(request(server()).get('/system/smtp?limit=100')).expect(200)
    ).body.data as Array<{ id: string; isActive: boolean }>;
    const active = list.filter((c) => c.isActive);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(b);
  });

  it('upserts and reads back a typed setting', async () => {
    await asAdmin(
      request(server()).put('/system/settings/features.signup_enabled'),
    )
      .send({ value: true, type: 'boolean', category: 'features' })
      .expect(200);
    const res = await asAdmin(
      request(server()).get('/system/settings/features.signup_enabled'),
    ).expect(200);
    expect(res.body.value).toBe(true);
    expect(res.body.type).toBe('boolean');
  });

  it('rejects a setting whose value mismatches its type', async () => {
    await asAdmin(request(server()).put('/system/settings/bad.setting'))
      .send({ value: 'not-a-number', type: 'number' })
      .expect(400);
  });

  it('creates an integration credential with redacted secret', async () => {
    const res = await asAdmin(request(server()).post('/system/integrations'))
      .send({
        provider: 'openai',
        name: `prod_${stamp}`,
        kind: 'api_key',
        secret: 'sk-super-secret',
        meta: { baseUrl: 'https://api.openai.com' },
      })
      .expect(201);
    expect(res.body.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secret');
  });

  it('records audit entries the admin can read', async () => {
    const res = await asAdmin(
      request(server()).get('/system/audit?entityType=smtp&limit=100'),
    ).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(
      res.body.data.some((r: { action: string }) => r.action === 'smtp.create'),
    ).toBe(true);
    // Audit metadata must never carry secret values.
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
  });
});
