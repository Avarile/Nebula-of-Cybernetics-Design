import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  forEachControllerHandler,
  hasMetadata,
} from '../../common/controller-scan';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { BEARER_SCHEME_NAME } from './openapi.constants';

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const;

const ENVELOPE_REF = '#/components/schemas/ErrorEnvelope';

/** operationId format shared with the SwaggerModule.createDocument operationIdFactory. */
export function operationId(controllerKey: string, methodKey: string): string {
  return `${controllerKey}_${methodKey}`;
}

/**
 * Applies a document-wide bearer security requirement, mirroring the global
 * `JwtAuthGuard`. Individual operations override this to `[]` when public.
 */
export function applyGlobalSecurity(doc: OpenAPIObject): OpenAPIObject {
  doc.security = [{ [BEARER_SCHEME_NAME]: [] }];
  return doc;
}

/**
 * Scans every controller handler for `@Public()` (method- or class-level, the
 * same metadata the JwtAuthGuard reads) and returns the set of operationIds
 * that require no authentication.
 */
export function collectPublicOperationIds(app: INestApplication): Set<string> {
  const reflector = app.get(Reflector);
  const ids = new Set<string>();

  // Shares `forEachControllerHandler` with the boot-time route-policy audit, so
  // the document's idea of "which routes are public" cannot drift from the
  // check that enforces every route declares a policy in the first place.
  forEachControllerHandler(app, (entry) => {
    if (hasMetadata(reflector, IS_PUBLIC_KEY, entry)) {
      ids.add(operationId(entry.controllerName, entry.methodName));
    }
  });

  return ids;
}

/** Clears the security requirement on public operations (they need no token). */
export function stripSecurityForPublic(
  doc: OpenAPIObject,
  publicIds: ReadonlySet<string>,
): OpenAPIObject {
  for (const pathItem of Object.values(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (
        pathItem as Record<
          string,
          { operationId?: string; security?: unknown[] }
        >
      )[method];
      if (op?.operationId && publicIds.has(op.operationId)) {
        op.security = [];
      }
    }
  }
  return doc;
}

/** Registers the single public error shape as a reusable component schema. */
export function registerErrorComponents(doc: OpenAPIObject): OpenAPIObject {
  doc.components ??= {};
  doc.components.schemas ??= {};
  doc.components.schemas.ErrorEnvelope = {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: [
          'code',
          'message',
          'statusCode',
          'correlationId',
          'timestamp',
          'path',
        ],
        properties: {
          code: {
            type: 'string',
            description: 'Stable, machine-readable error code.',
          },
          message: { type: 'string' },
          statusCode: { type: 'integer' },
          details: {
            nullable: true,
            description:
              'Optional structured detail (e.g. validation `issues[]`); null for internal errors.',
          },
          correlationId: {
            type: 'string',
            description: 'Correlates the response with server logs.',
          },
          timestamp: { type: 'string', format: 'date-time' },
          path: { type: 'string' },
        },
      },
    },
  };
  return doc;
}

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: ENVELOPE_REF } } },
  };
}

/**
 * Attaches the standard error responses (all rendered as `ErrorEnvelope`) to
 * every operation, without clobbering responses a handler already documents:
 *  - 400 when the operation accepts input (body or parameters)
 *  - 401 + 403 on authenticated (non-public) operations
 *  - 429 (throttled) and 500 on every operation
 *
 * Call `registerErrorComponents` first so the `$ref` resolves.
 */
export function attachStandardErrors(
  doc: OpenAPIObject,
  publicIds: ReadonlySet<string>,
): OpenAPIObject {
  for (const pathItem of Object.values(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (
        pathItem as Record<
          string,
          {
            operationId?: string;
            requestBody?: unknown;
            parameters?: unknown[];
            responses?: Record<string, unknown>;
          }
        >
      )[method];
      if (!op) {
        continue;
      }
      op.responses ??= {};
      const isPublic = !!op.operationId && publicIds.has(op.operationId);
      const hasInput =
        !!op.requestBody ||
        (Array.isArray(op.parameters) && op.parameters.length > 0);

      if (hasInput) {
        op.responses['400'] ??= errorResponse('Validation failed');
      }
      if (!isPublic) {
        op.responses['401'] ??= errorResponse(
          'Missing or invalid bearer token',
        );
        op.responses['403'] ??= errorResponse('Insufficient role');
      }
      op.responses['429'] ??= errorResponse('Too many requests (throttled)');
      op.responses['500'] ??= errorResponse('Internal server error');
    }
  }
  return doc;
}
