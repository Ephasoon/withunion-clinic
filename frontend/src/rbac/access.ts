import { isApiError } from "../api";
import { isRole, type Role } from "./roles";

/**
 * Whether `role` is one of `allowed`. An unknown role string (e.g. a
 * role added on the backend but not yet in this build) is never
 * allowed anything — it fails closed in the UI, and the backend still
 * decides what the user can actually do.
 */
export function isRoleAllowed(role: string | null | undefined, allowed: readonly Role[]): boolean {
  return isRole(role) && allowed.includes(role);
}

/** Whether the user holds one of the given roles. `null` (signed out) never does. */
export function hasRole(user: { role: string } | null | undefined, ...allowed: Role[]): boolean {
  return isRoleAllowed(user?.role, allowed);
}

/**
 * A backend 403: the user is signed in but the route's requireRole()
 * rejected their role. Show a "no access" message; do not sign out.
 */
export function isForbiddenError(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}
