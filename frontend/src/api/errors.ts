/**
 * Error codes the client itself produces when a request fails before
 * or outside the backend's error envelope. Every other code comes
 * straight from the backend (VALIDATION_ERROR, NOT_FOUND, ...).
 */
export const CLIENT_ERROR_CODES = {
  /** fetch() rejected: server unreachable, DNS failure, CORS, offline. */
  NETWORK_ERROR: "NETWORK_ERROR",
  /** The request was aborted through its AbortSignal. */
  ABORTED: "ABORTED",
  /** A non-2xx response whose body is not the backend's error envelope. */
  HTTP_ERROR: "HTTP_ERROR",
  /** A 2xx response whose body is not what the caller asked for. */
  INVALID_RESPONSE: "INVALID_RESPONSE",
} as const;

/**
 * Every failed request throws an ApiError. `details` is whatever the
 * backend put in `error.details`, or null when it sent none — the
 * backend omits it on 500s, unknown-route 404s and rate-limit 429s,
 * and sends null for most other errors. Validation errors carry a
 * Record<string, string[]> keyed by field; use `validationDetails()`
 * to read those safely.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Field errors from a VALIDATION_ERROR response, or null when there are none. */
export function validationDetails(error: unknown): Record<string, string[]> | null {
  if (!isApiError(error) || error.code !== "VALIDATION_ERROR") return null;
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;

  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(details)) {
    if (Array.isArray(messages)) {
      result[field] = messages.filter((m): m is string => typeof m === "string");
    }
  }
  return result;
}
