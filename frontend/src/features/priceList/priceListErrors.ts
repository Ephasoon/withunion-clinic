import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { fieldErrorsText } from "../../lib/fieldErrors";
import { NO_CHANGES_MESSAGE } from "./priceListForm";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  price: "Price",
  isActive: "Active",
};

/** User-facing text for a failed price-list create or update. Mirrors supplierErrors.ts. */
export function priceListErrorMessage(error: unknown, action: "create" | "update"): string {
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "PRICE_LIST_ITEM_ALREADY_EXISTS":
      return "A price list item with this name already exists (names are matched ignoring case and spacing).";
    case "NOT_FOUND":
      return "This price list item no longer exists.";
    case "VALIDATION_ERROR": {
      const fields = fieldErrorsText(error, FIELD_LABELS);
      if (fields) return fields;
      // PATCH's "at least one field" refine has no path, so it arrives with empty details.
      if (action === "update") return NO_CHANGES_MESSAGE;
      return "Some of the details entered are not valid. Check the form and try again.";
    }
  }
  return describeApiError(error);
}
