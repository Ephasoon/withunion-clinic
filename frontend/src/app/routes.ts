import type { ReactNode } from "react";
import { hasRole } from "../rbac/access";
import type { Role } from "../rbac/roles";

/**
 * One entry per role-protected screen. The router wraps each in
 * RequireRole, and the shell's navigation lists the entries the
 * current user's role may open, so both come from this one table.
 *
 * `roles` must match the backend requireRole() list of the endpoints
 * the screen depends on (docs/api-inventory.md §5) — the UI may hide
 * more than the backend forbids, but must never offer less protection.
 */
export interface FeatureRoute {
  /** Path relative to the app root, without a leading slash, e.g. "reception/queue". */
  path: string;
  /** Navigation label. */
  label: string;
  roles: readonly Role[];
  element: ReactNode;
}

/** Empty until feature screens are built. */
export const featureRoutes: readonly FeatureRoute[] = [];

export function navItemsFor(user: { role: string } | null): readonly FeatureRoute[] {
  return featureRoutes.filter((route) => hasRole(user, ...route.roles));
}
