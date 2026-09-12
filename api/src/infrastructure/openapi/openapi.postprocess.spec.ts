import type { OpenAPIObject } from '@nestjs/swagger';
import {
  applyGlobalSecurity,
  attachStandardErrors,
  operationId,
  registerErrorComponents,
  stripSecurityForPublic,
} from './openapi.postprocess';
import { BEARER_SCHEME_NAME } from './openapi.constants';

function baseDoc(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {
      '/auth/login': {
        post: {
          operationId: 'AuthController_login',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {},
        },
      },
      '/users': {
        get: { operationId: 'UsersController_list', responses: {} },
      },
    },
  } as unknown as OpenAPIObject;
}

describe('openapi.postprocess', () => {
  describe('operationId', () => {
    it('joins controller and method keys', () => {
      expect(operationId('AuthController', 'login')).toBe(
        'AuthController_login',
      );
    });
  });

  describe('applyGlobalSecurity', () => {
    it('sets a root bearer security requirement', () => {
      const doc = applyGlobalSecurity(baseDoc());
      expect(doc.security).toEqual([{ [BEARER_SCHEME_NAME]: [] }]);
    });
  });

  describe('stripSecurityForPublic', () => {
    it('sets security:[] on operations whose operationId is public', () => {
      const doc = stripSecurityForPublic(
        baseDoc(),
        new Set(['AuthController_login']),
      );
      expect(doc.paths['/auth/login'].post!.security).toEqual([]);
    });

    it('leaves non-public operations untouched', () => {
      const doc = stripSecurityForPublic(
        baseDoc(),
        new Set(['AuthController_login']),
      );
      expect(doc.paths['/users'].get!.security).toBeUndefined();
    });
  });

  describe('registerErrorComponents', () => {
    it('registers the ErrorEnvelope schema', () => {
      const doc = registerErrorComponents(baseDoc());
      const schema = doc.components!.schemas!.ErrorEnvelope as {
        properties: { error: { properties: Record<string, unknown> } };
      };
      expect(schema.properties.error.properties.code).toBeDefined();
      expect(schema.properties.error.properties.correlationId).toBeDefined();
    });
  });

  describe('attachStandardErrors', () => {
    it('adds 401/403/429/500 to non-public operations, referencing ErrorEnvelope', () => {
      const doc = registerErrorComponents(baseDoc());
      attachStandardErrors(doc, new Set());
      const get = doc.paths['/users'].get!;
      expect(get.responses['401']).toBeDefined();
      expect(get.responses['403']).toBeDefined();
      expect(get.responses['429']).toBeDefined();
      expect(get.responses['500']).toBeDefined();
      const ref = (
        get.responses['401'] as {
          content: Record<string, { schema: { $ref: string } }>;
        }
      ).content['application/json'].schema.$ref;
      expect(ref).toBe('#/components/schemas/ErrorEnvelope');
    });

    it('adds a 400 to operations that accept input', () => {
      const doc = registerErrorComponents(baseDoc());
      attachStandardErrors(doc, new Set());
      expect(doc.paths['/auth/login'].post!.responses['400']).toBeDefined();
    });

    it('does not add 401/403 to public operations', () => {
      const doc = registerErrorComponents(baseDoc());
      attachStandardErrors(doc, new Set(['AuthController_login']));
      const post = doc.paths['/auth/login'].post!;
      expect(post.responses['401']).toBeUndefined();
      expect(post.responses['403']).toBeUndefined();
      // server + throttle errors still apply
      expect(post.responses['500']).toBeDefined();
    });

    it('does not overwrite an already-documented response', () => {
      const doc = registerErrorComponents(baseDoc());
      doc.paths['/users'].get!.responses['500'] = { description: 'custom' };
      attachStandardErrors(doc, new Set());
      expect(
        (doc.paths['/users'].get!.responses['500'] as { description: string })
          .description,
      ).toBe('custom');
    });
  });
});
