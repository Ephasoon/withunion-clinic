/**
 * Application-level error with an HTTP status and a stable machine
 * -readable code. The global error handler uses this to decide what
 * is safe to send to the client — anything that ISN'T an AppError is
 * treated as unexpected and returns a generic 500 with no details,
 * per Phase 1 §27 ("error handling without leaking sensitive info").
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
