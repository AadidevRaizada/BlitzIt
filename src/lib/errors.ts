/**
 * Typed error hierarchy + result types.
 *
 * Expected/recoverable errors are returned as a `Result` from actions/services
 * (never thrown across the boundary). Unexpected errors are thrown, caught by
 * error boundaries, and reported to monitoring.
 */

export type AppErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'WINDOW_CLOSED'
  | 'ALREADY_SUBMITTED'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_FAILED'
  | 'EVALUATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('NOT_FOUND', message, details);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('FORBIDDEN', message, details);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super('UNAUTHORIZED', message, details);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION', message, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

/** Discriminated result returned by actions/services for expected outcomes. */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: { code: AppErrorCode; message: string } };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: AppErrorCode, message: string): Err {
  return { ok: false, error: { code, message } };
}

/** Convert any caught value into a typed `Err`. */
export function toErr(e: unknown): Err {
  if (e instanceof AppError) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  return {
    ok: false,
    error: { code: 'INTERNAL', message: 'Unexpected error' },
  };
}
