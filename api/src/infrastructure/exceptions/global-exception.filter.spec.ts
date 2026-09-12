import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ExceptionService } from './exception.service';
import { ErrorCode } from './error-codes';
import { GlobalExceptionFilter } from './global-exception.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function hostFor(url = '/x', id = 'req-1') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id, url }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  const logger = { debug: jest.fn(), error: jest.fn() } as any;
  const filter = new GlobalExceptionFilter(new ExceptionService(), logger);
  beforeEach(() => jest.clearAllMocks());

  it('writes the envelope with the mapped status for a CLIENT error (no Sentry)', () => {
    const { host, status, json } = hostFor('/users/1');
    filter.catch(new NotFoundException('nf'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.NOT_FOUND,
          statusCode: 404,
        }),
      }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('reports INTERNAL errors to Sentry and hides the raw message', () => {
    const { host, status, json } = hostFor('/chat');
    filter.catch(new Error('secret stack'), host);
    expect(status).toHaveBeenCalledWith(500);
    const env = json.mock.calls[0][0];
    expect(env.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(env.error.message).not.toContain('secret');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
