import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { fieldErrorsText } from "../../lib/fieldErrors";
import { NO_CHANGES_MESSAGE } from "./supplierForm";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  contactPerson: "Contact person",
  phone: "Phone",
  email: "Email",
  address: "Address",
  isActive: "Active",
};

/** User-facing text for a failed supplier create or update. Mirrors userErrors.ts. */
export function supplierErrorMessage(error: unknown, action: "create" | "update"): string {
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "NOT_FOUND":
      return "This supplier no longer exists.";
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
