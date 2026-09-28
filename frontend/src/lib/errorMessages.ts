import { CLIENT_ERROR_CODES, isApiError } from "../api";

/**
 * User-facing text for a failed request. Backend codes and messages
 * are from docs/api-inventory.md §1.2, §1.3 and §6.
 *
 * `notFound` replaces the backend's NOT_FOUND text where the page knows
 * better what is missing (e.g. "This patient record does not exist.").
 */
export function describeApiError(error: unknown, options: { notFound?: string } = {}): string {
  if (!isApiError(error)) return "Something went wrong. Please try again.";

  switch (error.code) {
    case "VALIDATION_ERROR":
      // Path-id check: the address itself is malformed.
      if (/^Invalid (\w+ )?id format$/i.test(error.message)) return "This link does not point to a valid record.";
      // Zod failures carry field details; the form shows them next to each field.
      if (error.message === "Invalid request body" || error.message === "Invalid query parameters") {
        return "Some of the details entered are not valid. Check the highlighted fields.";
      }
      // Service-level rules, e.g. "reason is required to cancel a visit".
      return error.message;
    case "NOT_FOUND":
      return options.notFound ?? error.message;
    case "VISIT_TERMINAL":
      return "This visit is already completed or cancelled, so it can no longer be changed.";
    case "FORBIDDEN":
      return "Your role is not allowed to do this. If the visit has moved on, refresh to see its current status.";
    case "UNAUTHENTICATED":
      return "Your session has ended. Please sign in again.";
    case "INTERNAL_ERROR":
      return "Something went wrong on the server. Please try again.";
    case CLIENT_ERROR_CODES.NETWORK_ERROR:
      return "Could not reach the server. Check your connection and try again.";
    case CLIENT_ERROR_CODES.ABORTED:
      return "The request was cancelled.";
  }
  if (error.status >= 500) return "The server is not responding. Please try again shortly.";
  return error.message;
}
