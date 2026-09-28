import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { currentStatusFromMessage } from "../laboratory/labErrors";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The medicine named by an error that mentions "item <id>" (the backend
 * reports prescription item ids, docs §5.8), or null if it can't be told.
 */
export function medicineFromMessage(
  message: string,
  items: readonly { id: string; medicineName: string }[]
): string | null {
  const match = /item ([0-9a-f-]{36})/i.exec(message);
  const itemId = match?.[1];
  if (!itemId || !UUID.test(itemId)) return null;
  return items.find((i) => i.id.toLowerCase() === itemId.toLowerCase())?.medicineName ?? null;
}

/**
 * User-facing text for a failed pharmacy action. `items` lets messages
 * that name an item id say which medicine instead.
 * INCOMPLETE_DISPENSING is shown as a list by the page (parseIncompleteDispensing).
 */
export function pharmacyErrorMessage(error: unknown, items: readonly { id: string; medicineName: string }[] = []): string {
  if (!isApiError(error)) return describeApiError(error);
  const medicine = medicineFromMessage(error.message, items);
  const forMedicine = medicine ? ` (${medicine})` : "";

  switch (error.code) {
    case "INSUFFICIENT_STOCK":
      // Also returned when the inventoryItemId does not exist (backend quirk, docs §5.8).
      return `Not enough stock, or that stock item no longer exists${forMedicine}.`;
    case "EXCEEDS_PRESCRIBED_QUANTITY":
      return `That quantity is more than is left to dispense${forMedicine}.`;
    case "ITEM_ALREADY_TERMINAL":
      return `This medicine has already been fully dispensed or marked unavailable${forMedicine}.`;
    case "ITEM_NOT_IN_PRESCRIPTION":
      return "One of the medicines does not belong to this prescription. The prescription has been reloaded — check it and try again.";
    case "INVALID_VISIT_STATE": {
      const current = currentStatusFromMessage(error.message);
      return current
        ? `This can’t be done while the visit is “${VISIT_STATUS_LABELS[current].toLowerCase()}”. The page shows its current status.`
        : "The visit is not at the right pharmacy step for this. The page shows its current status.";
    }
    case "VISIT_TERMINAL":
      return "This visit has been completed or cancelled, so its prescriptions can no longer change.";
    case "NOT_FOUND":
      return "This prescription does not exist.";
  }
  return describeApiError(error);
}

/**
 * What a failed POST /dispense means for the batch.
 * - "rolled-back": a 4xx. Every 4xx is raised before or inside the single
 *   transaction, so nothing from the batch was dispensed.
 * - "unknown": no response (network) or a 5xx. The transaction may have
 *   committed — the route writes audit entries after it — so the page must
 *   say it could not confirm and show the re-fetched quantities.
 */
export function dispenseFailureOutcome(error: unknown): "rolled-back" | "unknown" {
  return isApiError(error) && error.status >= 400 && error.status < 500 ? "rolled-back" : "unknown";
}
