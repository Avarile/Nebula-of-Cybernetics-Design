import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';
import { buildEnvelope } from './error-envelope';

describe('buildEnvelope', () => {
  it('serializes a CLIENT error with its real message and details', () => {
    const err = new AppException(ErrorCode.USER_NOT_FOUND);
    const env = buildEnvelope(err, 'req-1', '/users/1');
    expect(env.error).toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
      message: 'User not found',
      statusCode: 404,
      correlationId: 'req-1',
      path: '/users/1',
    });
    expect(typeof env.error.timestamp).toBe('string');
  });

  it('reports the exception status, honouring a boundary status override', () => {
    const err = new AppException(ErrorCode.CLIENT_ERROR, {
      status: 413,
      message: 'Payload too large',
    });
    const env = buildEnvelope(err, 'req-5', '/upload');
    expect(env.error.statusCode).toBe(413);
    expect(env.error.code).toBe(ErrorCode.CLIENT_ERROR);
    expect(env.error.message).toBe('Payload too large');
  });

  it('hides the raw message of INTERNAL errors behind the safe registry message', () => {
    const err = new AppException(ErrorCode.AGENT_RUN_FAILED, {
      message: 'stacktrace: secret',
    });
    const env = buildEnvelope(err, 'req-2', '/chat');
    expect(env.error.statusCode).toBe(500);
    expect(env.error.message).toBe('The agent run failed');
    expect(env.error.message).not.toContain('secret');
  });

  it('never leaks details for INTERNAL errors, even when the exception carries them', () => {
    const err = new AppException(ErrorCode.AGENT_RUN_FAILED, {
      details: { runId: 'r1' },
    });
    const env = buildEnvelope(err, 'req-3', '/chat');
    expect(env.error.details).toBeNull();
    expect(env.error.message).toBe('The agent run failed');
  });

  it('preserves details for CLIENT errors (gate only affects INTERNAL)', () => {
    const err = new AppException(ErrorCode.VALIDATION_FAILED, {
      details: { issues: [{ path: 'a', message: 'b' }] },
    });
    const env = buildEnvelope(err, 'req-4', '/records');
    expect(env.error.details).toEqual({
      issues: [{ path: 'a', message: 'b' }],
    });
  });
});
