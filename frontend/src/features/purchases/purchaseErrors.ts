import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { fieldErrorsText } from "../../lib/fieldErrors";
import { writeFailureOutcome } from "../billing/billingErrors";

const FIELD_LABELS: Record<string, string> = {
  supplierId: "Supplier",
  purchaseDate: "Purchase date",
  referenceNumber: "Reference number",
  notes: "Notes",
  items: "Items",
};

/** The id in "Inventory item <id> does not exist", or null. */
export function invalidInventoryItemId(message: string): string | null {
  return /^Inventory item (\S+) does not exist$/.exec(message)?.[1] ?? null;
}

/**
 * Text for a failed POST /purchases. `itemNames` maps inventory ids to
 * the names the owner picked from, so a rejected line can be named.
 */
export function createPurchaseErrorMessage(error: unknown, itemNames: ReadonlyMap<string, string> = new Map()): string {
  if (writeFailureOutcome(error) === "unknown") {
    return "The server didn’t confirm whether this purchase was saved. Check the purchases list before trying again, so it isn’t entered twice.";
  }
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "INVALID_INVENTORY_ITEM": {
      const id = invalidInventoryItemId(error.message);
      const which = id ? `“${itemNames.get(id) ?? id}”` : "One of the stock items";
      return `${which} no longer exists in inventory, so nothing was saved — the whole purchase was rolled back, not just that line. The stock list has been refreshed; change or remove that line and save again.`;
    }
    case "NOT_FOUND":
      return "The chosen supplier no longer exists, so nothing was saved. Choose another supplier.";
    case "VALIDATION_ERROR":
      return fieldErrorsText(error, FIELD_LABELS) ?? "Some of the details entered are not valid. Check the form and try again.";
  }
  return describeApiError(error);
}

/** Text for a failed POST /purchases/:id/receive. */
export function receivePurchaseErrorMessage(error: unknown): string {
  if (writeFailureOutcome(error) === "unknown") {
    return "The server didn’t confirm whether this purchase was received. The page has been refreshed — check its status and the stock levels before trying again.";
  }
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "PURCHASE_ALREADY_RECEIVED":
      return "This purchase has already been received, so its stock was added once and won’t be added again. The page has been refreshed.";
    case "NOT_FOUND":
      return "This purchase no longer exists.";
  }
  return describeApiError(error);
}
