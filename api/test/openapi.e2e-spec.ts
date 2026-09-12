import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { apiReference } from '@scalar/nestjs-api-reference';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { Public } from '../src/common/decorators/public.decorator';
import { setupOpenApi } from '../src/infrastructure/openapi/openapi.setup';
import type { OpenApiConfig } from '../src/config/configurations/openapi.config';

/**
 * OpenAPI/Scalar HTTP contract e2e. Hermetic: boots a one-controller test module
 * with a stubbed ConfigService (no DB/Redis/Mastra), so it exercises setupOpenApi
 * in isolation and avoids MastraModule's ESM-only dependency.
 * Run with `pnpm test:e2e -- openapi`.
 */

const sampleSchema = z.object({ name: z.string().min(1) });
class SampleDto extends createZodDto(sampleSchema) {}

@Controller('samples')
class SampleController {
  @Get()
  list(): string[] {
    return [];
  }

  @Post()
  create(@Body() body: SampleDto): SampleDto {
    return body;
  }

  @Public()
  @Get('ping')
  ping(): string {
    return 'pong';
  }
}

async function makeApp(cfg: OpenApiConfig): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [SampleController],
    providers: [
      { provide: ConfigService, useValue: { getOrThrow: () => cfg } },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  setupOpenApi(app);
  await app.init();
  return app;
}

describe('OpenAPI / Scalar (e2e)', () => {
  describe('when enabled', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await makeApp({ enabled: true, serverUrl: '' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves a valid OpenAPI 3 document at /openapi.json', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.info?.title).toBeTruthy();
      // routes are auto-discovered from the Nest controllers
      expect(res.body.paths['/samples']).toBeDefined();
    });

    it('registers the JWT bearer security scheme', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');

      expect(res.body.components?.securitySchemes?.bearer).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
    });

    it('generates the request body schema from the Zod DTO', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');

      const post = res.body.paths['/samples']?.post;
      const schema = post?.requestBody?.content?.['application/json']?.schema;
      // either inline or a $ref into components.schemas
      const resolved = schema?.$ref
        ? res.body.components.schemas[schema.$ref.split('/').pop()]
        : schema;
      expect(resolved?.properties?.name).toBeDefined();
      expect(resolved?.required).toContain('name');
    });

    it('applies a global bearer security requirement', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');
      expect(res.body.security).toEqual([{ bearer: [] }]);
    });

    it('marks @Public() operations as security:[] (no auth)', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');
      expect(res.body.paths['/samples/ping']?.get?.security).toEqual([]);
      // a non-public operation inherits the global requirement (no per-op override)
      expect(res.body.paths['/samples']?.get?.security).toBeUndefined();
    });

    it('registers the ErrorEnvelope component and standard error responses', async () => {
      const res = await request(app.getHttpServer()).get('/openapi.json');

      expect(
        res.body.components?.schemas?.ErrorEnvelope?.properties?.error,
      ).toBeDefined();

      // non-public op has 401/500; public op omits 401
      const listResponses = res.body.paths['/samples']?.get?.responses;
      expect(listResponses['401']).toBeDefined();
      expect(listResponses['500']).toBeDefined();
      expect(listResponses['401'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ErrorEnvelope',
      );
      expect(
        res.body.paths['/samples/ping']?.get?.responses['401'],
      ).toBeUndefined();

      // op with a request body gets a 400
      expect(res.body.paths['/samples']?.post?.responses['400']).toBeDefined();
    });

    it('serves the Scalar reference UI at /reference', async () => {
      const res = await request(app.getHttpServer()).get('/reference');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('serves a Scalar-compatible CSP on /reference (not helmet’s strict default)', async () => {
      const res = await request(app.getHttpServer()).get('/reference');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      // must allow the CDN bundle + inline bootstrap Scalar needs
      expect(csp).toContain('https://cdn.jsdelivr.net');
      expect(csp).toContain("'unsafe-inline'");
    });
  });

  describe('when disabled (kill-switch)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await makeApp({ enabled: false, serverUrl: '' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 404 for /openapi.json', async () => {
      await request(app.getHttpServer()).get('/openapi.json').expect(404);
    });

    it('returns 404 for /reference', async () => {
      await request(app.getHttpServer()).get('/reference').expect(404);
    });
  });

  // Guards against an unused-import lint error while the suite proves wiring.
  it('has the Scalar middleware factory available', () => {
    expect(typeof apiReference).toBe('function');
  });
});
