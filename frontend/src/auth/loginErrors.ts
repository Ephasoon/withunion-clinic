import { isApiError } from "../api";

/** User-facing text for a failed POST /auth/login. */
export function loginErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Sign-in failed. Please try again.";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "Incorrect username or password.";
    case "RATE_LIMITED":
      return "Too many sign-in attempts. Please wait a few minutes and try again.";
    case "VALIDATION_ERROR":
      return "Enter a username and password.";
    case "NETWORK_ERROR":
      return "Could not reach the server. Check your connection.";
  }
  if (error.status === 0 || error.status >= 500) {
    return "The server is not responding. Please try again shortly.";
  }
  return error.message;
}
