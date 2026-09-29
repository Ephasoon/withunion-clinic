import { isApiError, validationDetails } from "../api";

/**
 * A VALIDATION_ERROR's field details as one line of text, e.g.
 * "Email: must be a valid email · Name: name is required", or null when
 * the error has no field details. Refines without a `path` (Users and
 * Suppliers PATCH "at least one field") arrive with details `{}`, so they
 * return null and the caller shows its own message (docs §7.2).
 */
export function fieldErrorsText(error: unknown, labels: Record<string, string>): string | null {
  if (!isApiError(error) || error.code !== "VALIDATION_ERROR") return null;
  const lines = Object.entries(validationDetails(error) ?? {})
    .filter(([, messages]) => messages.length > 0)
    .map(([field, messages]) => `${labels[field] ?? field}: ${messages.join("; ")}`);
  return lines.length > 0 ? lines.join(" · ") : null;
}
