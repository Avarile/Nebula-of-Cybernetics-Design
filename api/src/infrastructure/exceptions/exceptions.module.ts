import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ExceptionService } from './exception.service';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Global exception handling. Provides the injectable throw API (ExceptionService)
 * everywhere, and registers the single global filter that normalizes every error
 * into the standard envelope.
 */
@Global()
@Module({
  providers: [
    ExceptionService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
