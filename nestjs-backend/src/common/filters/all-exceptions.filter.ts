import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Error response contract for the whole API: { statusCode, error, message }. */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

/**
 * Normalizes every error leaving the API.
 *
 * Two invariants hold regardless of the exception's origin:
 * - the response body never carries a stack trace or any internal detail that
 *   would help an attacker map the system;
 * - unexpected failures collapse to a generic 500 message, with the real cause
 *   logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message } = this.toErrorBody(exception);

    // Log the full exception server-side only. The request path is safe to
    // log; bodies, headers and query strings are not — they carry credentials
    // and PII.
    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${statusCode}`);
    }

    response.status(statusCode).json({ statusCode, error, message });
  }

  private toErrorBody(exception: unknown): ErrorResponseBody {
    // Unknown exception: nothing from it reaches the client.
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    // For a string payload `exception.message` holds that same string, so the
    // empty object below falls through to it.
    const body: Record<string, unknown> =
      typeof payload === 'string' ? {} : (payload as Record<string, unknown>);

    return {
      statusCode,
      // Nest's built-in exceptions put a human phrase here ("Not Found").
      // Only a real SCREAMING_SNAKE_CASE domain code is kept; anything else
      // falls back to the status-derived code the Error Catalog defines.
      error: this.isDomainErrorCode(body.error)
        ? body.error
        : this.defaultErrorCode(statusCode),
      message: (body.message ?? exception.message) as string | string[],
    };
  }

  /** A domain code is SCREAMING_SNAKE_CASE, e.g. `VIDEO_NOT_PUBLISHED`. */
  private isDomainErrorCode(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value);
  }

  /** Domain-less fallback code in SCREAMING_SNAKE_CASE, per the Error Catalog. */
  private defaultErrorCode(statusCode: number): string {
    // HttpStatus is a numeric enum, so its reverse mapping already holds the
    // SCREAMING_SNAKE_CASE name — no array built and scanned per error.
    const name: unknown = (HttpStatus as Record<number, unknown>)[statusCode];

    return typeof name === 'string' ? name : 'ERROR';
  }
}
