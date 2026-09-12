import { HttpException } from '@nestjs/common';
import { AppException } from './app-exception';
import { ErrorCode, ErrorKind } from './error-codes';

describe('AppException', () => {
  it('derives status, kind, and default message from the registry', () => {
    const err = new AppException(ErrorCode.USER_NOT_FOUND);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
    expect(err.code).toBe(ErrorCode.USER_NOT_FOUND);
    expect(err.kind).toBe(ErrorKind.CLIENT);
    expect(err.message).toBe('User not found');
  });

  it('honours a status override (boundary passthrough for unmapped statuses)', () => {
    const err = new AppException(ErrorCode.CLIENT_ERROR, { status: 422 });
    expect(err.getStatus()).toBe(422);
    expect(err.code).toBe(ErrorCode.CLIENT_ERROR);
    expect(err.kind).toBe(ErrorKind.CLIENT);
  });

  it('honours a message override and stores details + cause', () => {
    const cause = new Error('root');
    const err = new AppException(ErrorCode.FILE_INVALID_STATE, {
      message: 'File is not awaiting upload (status=AVAILABLE)',
      details: { status: 'AVAILABLE' },
      cause,
    });
    expect(err.message).toBe('File is not awaiting upload (status=AVAILABLE)');
    expect(err.details).toEqual({ status: 'AVAILABLE' });
    expect(err.cause).toBe(cause);
  });
});
