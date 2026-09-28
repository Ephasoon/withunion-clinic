import type { SignOutReason } from "./AuthProvider";
import type { AuthState } from "./authState";

export type AuthGuardDecision = "wait" | "error" | "allow" | "redirect";

/** Authenticated area: signed-out users are redirected to /login. */
export function decideAuthGuard(state: AuthState): AuthGuardDecision {
  switch (state.status) {
    case "loading":
      return "wait";
    case "error":
      return "error";
    case "authenticated":
      return "allow";
    case "unauthenticated":
      return "redirect";
  }
}

/** Login page: signed-in users are redirected into the app. */
export function decideGuestGuard(state: AuthState): AuthGuardDecision {
  switch (state.status) {
    case "loading":
      return "wait";
    case "error":
      return "error";
    case "authenticated":
      return "redirect";
    case "unauthenticated":
      return "allow";
  }
}

/**
 * Whether RequireAuth should remember the page to return to after the
 * next sign-in. Not after the user signed out on purpose — whether or
 * not the server confirmed it — so the next person to sign in starts
 * at home rather than on the previous user's page.
 */
export function shouldSaveReturnPath(reason: SignOutReason): boolean {
  return reason !== "logout" && reason !== "logout-failed";
}

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";

/**
 * Where to go after signing in, from the location RequireAuth saved
 * when it redirected to /login. Only same-app absolute paths are
 * accepted: anything else (missing, "//host", a full URL, the login
 * page itself) falls back to home, so this can never become an open
 * redirect or a login loop.
 */
export function safeRedirectPath(from: unknown): string {
  let path: string | undefined;
  if (typeof from === "string") {
    path = from;
  } else if (typeof from === "object" && from !== null && typeof (from as { pathname?: unknown }).pathname === "string") {
    const loc = from as { pathname: string; search?: unknown; hash?: unknown };
    path =
      loc.pathname +
      (typeof loc.search === "string" ? loc.search : "") +
      (typeof loc.hash === "string" ? loc.hash : "");
  }

  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return HOME_PATH;
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}?`) || path.startsWith(`${LOGIN_PATH}/`)) return HOME_PATH;
  return path;
}
