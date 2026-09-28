import { isApiError, validationDetails } from "../../api";
import { describeApiError } from "../../lib/errorMessages";

const FIELD_LABELS: Record<string, string> = {
  dateFrom: "Start date",
  dateTo: "End date",
  status: "Status",
  groupBy: "Group by",
  supplierId: "Supplier id",
};

/**
 * User-facing text for a failed report request. A VALIDATION_ERROR shows
 * the backend's specific field messages (e.g. "Start date: dateFrom must
 * not be after dateTo"); every other error uses describeApiError.
 */
export function reportErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === "VALIDATION_ERROR") {
    const details = validationDetails(error);
    const lines = Object.entries(details ?? {})
      .filter(([, messages]) => messages.length > 0)
      .map(([field, messages]) => `${FIELD_LABELS[field] ?? field}: ${messages.join("; ")}`);
    if (lines.length > 0) return lines.join(" · ");
    // Refinements without a path, or unknown query parameters, come without field details.
    return error.message;
  }
  return describeApiError(error);
}
