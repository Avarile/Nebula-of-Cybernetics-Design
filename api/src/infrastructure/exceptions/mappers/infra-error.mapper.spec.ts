import { ErrorCode } from '../error-codes';
import { mapInfraError } from './infra-error.mapper';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

describe('mapInfraError', () => {
  it('maps a Postgres unique violation to CONFLICT', () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CONFLICT);
  });

  // Drizzle wraps every failed statement in a DrizzleQueryError whose own
  // `code` is undefined; the SQLSTATE sits on `cause`. Matching the outer error
  // only meant NONE of the rules below ever fired against a real query — the
  // long-standing 23505 rule included. These cases are the shape the boundary
  // actually receives.
  describe('errors wrapped by the query builder', () => {
    const wrapped = (sqlstate: string) => {
      const driverError = Object.assign(new Error('driver'), {
        code: sqlstate,
      });
      return Object.assign(new Error('Failed query: insert into ...'), {
        name: 'DrizzleQueryError',
        cause: driverError,
      });
    };

    it('finds a unique violation through the wrapper', () => {
      expect(mapInfraError(wrapped('23505'))?.code).toBe(ErrorCode.CONFLICT);
    });

    it('finds a foreign-key violation through the wrapper', () => {
      expect(mapInfraError(wrapped('23503'))?.code).toBe(ErrorCode.CONFLICT);
    });

    it('finds an invalid enum value through the wrapper', () => {
      expect(mapInfraError(wrapped('22P02'))?.code).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
    });

    it('finds a connection failure through the wrapper', () => {
      expect(mapInfraError(wrapped('08006'))?.code).toBe(
        ErrorCode.DB_UNAVAILABLE,
      );
    });

    it('finds a Redis failure through the wrapper', () => {
      const inner = Object.assign(new Error('redis down'), {
        name: 'MaxRetriesPerRequestError',
      });
      const outer = Object.assign(new Error('cache read failed'), {
        name: 'CacheError',
        cause: inner,
      });
      expect(mapInfraError(outer)?.code).toBe(ErrorCode.CACHE_UNAVAILABLE);
    });

    it('still returns null when nothing in the chain is recognised', () => {
      const inner = Object.assign(new Error('inner'), { code: 'WHO_KNOWS' });
      const outer = Object.assign(new Error('outer'), { cause: inner });
      expect(mapInfraError(outer)).toBeNull();
    });

    // The filter is the one place that must not throw, so a self-referential
    // chain has to terminate rather than spin.
    it('terminates on a cyclic cause chain', () => {
      const a = new Error('a') as Error & { cause?: unknown };
      const b = new Error('b') as Error & { cause?: unknown };
      a.cause = b;
      b.cause = a;
      expect(mapInfraError(a)).toBeNull();
    });
  });

  // Integrity violations describe the request, not a server fault. Unmapped,
  // they escaped as INTERNAL_ERROR: posting a contact against a company id that
  // did not exist answered 500 instead of telling the caller what was wrong.
  it('maps a Postgres foreign-key violation to CONFLICT', () => {
    const err = Object.assign(new Error('fk'), { code: '23503' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CONFLICT);
  });

  it('maps not-null and check violations to VALIDATION_FAILED', () => {
    expect(
      mapInfraError(Object.assign(new Error('null'), { code: '23502' }))?.code,
    ).toBe(ErrorCode.VALIDATION_FAILED);
    expect(
      mapInfraError(Object.assign(new Error('check'), { code: '23514' }))?.code,
    ).toBe(ErrorCode.VALIDATION_FAILED);
  });

  // Raised when a raw path or query parameter reaches an enum column unchecked.
  it('maps an invalid text representation to VALIDATION_FAILED', () => {
    const err = Object.assign(new Error('bad enum'), { code: '22P02' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('preserves the driver error as the cause', () => {
    const err = Object.assign(new Error('fk'), { code: '23503' });
    expect(mapInfraError(err)?.cause).toBe(err);
  });

  it('maps a Postgres connection-class error to DB_UNAVAILABLE', () => {
    const err = Object.assign(new Error('down'), { code: '08006' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.DB_UNAVAILABLE);
  });

  it('maps SearchEngineError to SEARCH_UNAVAILABLE', () => {
    expect(mapInfraError(new SearchEngineError('meili down'))?.code).toBe(
      ErrorCode.SEARCH_UNAVAILABLE,
    );
  });

  it('maps NoActiveEmailConfigError to MAIL_CONFIG_MISSING', () => {
    expect(mapInfraError(new NoActiveEmailConfigError('IMAP'))?.code).toBe(
      ErrorCode.MAIL_CONFIG_MISSING,
    );
  });

  it('maps crypto envelope failures to CRYPTO_DECRYPT_FAILED', () => {
    expect(
      mapInfraError(new Error('Malformed encryption envelope.'))?.code,
    ).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
    expect(
      mapInfraError(
        new Error('Unsupported state or unable to authenticate data'),
      )?.code,
    ).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
  });

  it('maps a Redis MaxRetriesPerRequestError to CACHE_UNAVAILABLE', () => {
    const err = Object.assign(new Error('redis down'), {
      name: 'MaxRetriesPerRequestError',
    });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CACHE_UNAVAILABLE);
  });

  it('maps object-not-found and network errors', () => {
    expect(
      mapInfraError(Object.assign(new Error(), { code: 'NoSuchKey' }))?.code,
    ).toBe(ErrorCode.STORAGE_OBJECT_NOT_FOUND);
    expect(
      mapInfraError(Object.assign(new Error(), { code: 'ECONNREFUSED' }))?.code,
    ).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
  });

  // A chat request with AI_GATEWAY_API_KEY unset used to answer 500, which
  // reads as "our bug" when it is in fact "the model gateway refused us".
  describe('AI SDK gateway errors', () => {
    const gatewayError = (
      name: string,
      type: string,
      statusCode: number,
    ): Error =>
      Object.assign(new Error('gateway said no'), { name, type, statusCode });

    it('maps an authentication failure to LLM_PROVIDER_ERROR', () => {
      const err = gatewayError(
        'GatewayAuthenticationError',
        'authentication_error',
        401,
      );
      expect(mapInfraError(err)?.code).toBe(ErrorCode.LLM_PROVIDER_ERROR);
    });

    it('maps an upstream 5xx to LLM_PROVIDER_ERROR', () => {
      const err = gatewayError(
        'GatewayInternalServerError',
        'internal_server_error',
        500,
      );
      expect(mapInfraError(err)?.code).toBe(ErrorCode.LLM_PROVIDER_ERROR);
    });

    it('maps a rate limit to LLM_RATE_LIMITED', () => {
      const err = gatewayError(
        'GatewayRateLimitError',
        'rate_limit_exceeded',
        429,
      );
      expect(mapInfraError(err)?.code).toBe(ErrorCode.LLM_RATE_LIMITED);
    });

    it('maps a timeout to LLM_TIMEOUT', () => {
      const err = gatewayError('GatewayTimeoutError', 'timeout', 504);
      expect(mapInfraError(err)?.code).toBe(ErrorCode.LLM_TIMEOUT);
    });

    // Detection is structural, so it must not swallow unrelated errors that
    // merely happen to carry one of the same properties.
    it('ignores errors that only partly match the shape', () => {
      expect(
        mapInfraError(
          Object.assign(new Error('nope'), {
            name: 'GatewayLookalike',
            statusCode: 500,
          }),
        ),
      ).toBeNull();
      expect(
        mapInfraError(
          Object.assign(new Error('nope'), {
            name: 'TypeError',
            type: 'x',
            statusCode: 500,
          }),
        ),
      ).toBeNull();
    });
  });

  it('returns null for unrecognized errors', () => {
    expect(mapInfraError(new Error('mystery'))).toBeNull();
  });
});
