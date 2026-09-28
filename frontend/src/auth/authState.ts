import { isApiError } from "../api";
import type { AuthUser } from "./types";

/**
 * The frontend's view of the session. `error` covers the case where
 * /auth/me could not be answered at all (backend down, 5xx): the user
 * is neither known to be signed in nor known to be signed out, so they
 * are not sent to the login page for it.
 */
export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" }
  | { status: "error"; error: unknown };

/** The subset of a TanStack Query result that decides the auth state. */
export interface MeQueryResult {
  status: "pending" | "error" | "success";
  data: AuthUser | null | undefined;
  error: unknown;
}

export function deriveAuthState(query: MeQueryResult): AuthState {
  // Known data wins over a failed background refetch.
  if (query.data !== undefined) {
    return query.data ? { status: "authenticated", user: query.data } : { status: "unauthenticated" };
  }
  if (query.status === "error") return { status: "error", error: query.error };
  return { status: "loading" };
}

/**
 * A 401 from requireAuth/requireRole: there is no (longer a) session.
 * Login's own 401 is INVALID_CREDENTIALS and is deliberately excluded —
 * a wrong password is not a session ending.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return isApiError(error) && error.status === 401 && error.code === "UNAUTHENTICATED";
}
