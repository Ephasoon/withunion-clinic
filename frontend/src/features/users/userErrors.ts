import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import { fieldErrorsText } from "../../lib/fieldErrors";

const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  username: "Username",
  password: "Password",
  newPassword: "New password",
  role: "Role",
  isActive: "Active",
};

export type UserAction = "create" | "update" | "reset-password";

/**
 * User-facing text for a failed users request. Specific codes get fixed
 * messages. `secrets` are values the user just submitted that must never
 * be shown (passwords): if the final text would contain one — for
 * example a backend message echoing request data — a generic message is
 * shown instead.
 */
export function userErrorMessage(error: unknown, action: UserAction, secrets: readonly string[] = []): string {
  const message = baseMessage(error, action);
  return secrets.some((s) => s !== "" && message.includes(s)) ? "The request failed. Please check the form and try again." : message;
}

function baseMessage(error: unknown, action: UserAction): string {
  if (!isApiError(error)) return describeApiError(error);
  switch (error.code) {
    case "USERNAME_ALREADY_EXISTS":
      return "That username is already taken. Choose another.";
    case "SELF_DEACTIVATION_NOT_ALLOWED":
      return "You can’t deactivate your own account.";
    case "SELF_DEMOTION_NOT_ALLOWED":
      return "You can’t change your own role away from Owner.";
    case "LAST_ACTIVE_OWNER":
      return "This change would leave the clinic with no active Owner. Another Owner may have just been changed — the list has been refreshed.";
    case "NOT_FOUND":
      return "This user no longer exists.";
    case "VALIDATION_ERROR": {
      const fields = fieldErrorsText(error, FIELD_LABELS);
      if (fields) return fields;
      // PATCH's "at least one field" refine has no path, so it arrives with empty details.
      if (action === "update") return "Change at least one field (name, role or active status) before saving.";
      return "Some of the details entered are not valid. Check the form and try again.";
    }
  }
  return describeApiError(error);
}
