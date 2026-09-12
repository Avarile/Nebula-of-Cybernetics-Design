import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { ExceptionService } from './exception.service';
import { ErrorKind } from './error-codes';
import { buildEnvelope } from './error-envelope';

interface RequestLike {
  id?: string;
  url?: string;
}
interface ResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly errors: ExceptionService,
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();

    const appErr = this.errors.from(exception);
    const correlationId = req.id ?? '-';
    const envelope = buildEnvelope(appErr, correlationId, req.url ?? '');

    if (appErr.kind === ErrorKind.CLIENT) {
      this.logger.debug({ code: appErr.code, correlationId }, appErr.message);
    } else {
      this.logger.error(
        { err: exception, code: appErr.code, correlationId },
        appErr.message,
      );
      Sentry.captureException(appErr.cause ?? exception, {
        tags: { code: appErr.code, correlationId },
      });
    }

    res.status(envelope.error.statusCode).json(envelope);
  }
}
