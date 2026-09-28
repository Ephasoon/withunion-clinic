import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { currentStatusFromMessage } from "../laboratory/labErrors";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";

/** User-facing text for a failed billing or receipt request (docs §5.10–5.11). */
export function billingErrorMessage(error: unknown): string {
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "INVOICE_ALREADY_EXISTS":
      return "This visit already has an invoice. It has been loaded below.";
    case "INVOICE_NOT_OPEN":
      return "This invoice is already paid, so it can no longer be changed.";
    case "OVERPAYMENT":
      return "That payment is more than the remaining balance. The balance shown has been refreshed.";
    case "INVOICE_NOT_PAID":
      return "The invoice still has a balance to pay, so billing can’t be completed yet.";
    case "RECEIPT_NOT_AVAILABLE_UNTIL_PAID":
      return "A receipt is available once the invoice is fully paid and billing is completed.";
    case "INVALID_VISIT_STATE": {
      const current = currentStatusFromMessage(error.message);
      return current
        ? `This can’t be done while the visit is “${VISIT_STATUS_LABELS[current].toLowerCase()}”. The page shows its current status.`
        : "The visit is not waiting for billing. The page shows its current status.";
    }
    case "VISIT_TERMINAL":
      return "This visit has already been completed or cancelled.";
    case "NOT_FOUND":
      return "This invoice or visit does not exist.";
  }
  return describeApiError(error);
}

/**
 * What a failed write means. A 4xx was refused before anything was
 * saved. A 5xx or no response may have come after the change was saved
 * (the routes write their audit entries after the service commits), so
 * for a payment the page must say it could not confirm and show the
 * re-fetched payments — never invite a blind retry that could charge twice.
 */
export function writeFailureOutcome(error: unknown): "not-saved" | "unknown" {
  return isApiError(error) && error.status >= 400 && error.status < 500 ? "not-saved" : "unknown";
}
