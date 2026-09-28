import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";
import type { VisitStatus } from "../visits/types";

/** The visit status named in an INVALID_VISIT_STATE message ("… (currently AT_LAB)"), if recognisable. */
export function currentStatusFromMessage(message: string): VisitStatus | null {
  const match = /\(currently ([A-Z_]+)\)/.exec(message);
  const status = match?.[1];
  return status && status in VISIT_STATUS_LABELS ? (status as VisitStatus) : null;
}

/**
 * User-facing text for a failed lab action (start, results, complete).
 * INCOMPLETE_RESULTS is not handled here: the page shows it as a list
 * (see parseIncompleteResults), falling back to describeApiError.
 */
export function labErrorMessage(error: unknown): string {
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "LAB_ORDER_NOT_REQUESTED":
      return "This order was already completed.";
    case "INVALID_VISIT_STATE": {
      const current = currentStatusFromMessage(error.message);
      return current
        ? `This can’t be done while the visit is “${VISIT_STATUS_LABELS[current].toLowerCase()}”. The page shows its current status.`
        : "The visit is not at the right lab step for this. The page shows its current status.";
    }
    case "VISIT_TERMINAL":
      return "This visit has been completed or cancelled, so its lab work can no longer change.";
    case "ITEM_NOT_IN_ORDER":
      return "One of the tests does not belong to this order. The order has been reloaded — check the results and save again.";
    case "NOT_FOUND":
      return "This lab order does not exist.";
  }
  return describeApiError(error);
}
