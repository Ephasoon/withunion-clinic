import type { ComponentType } from "react";
import { PatientDetailPage } from "../features/patients/PatientDetailPage";
import { PatientSearchPage } from "../features/patients/PatientSearchPage";
import { RegisterPatientPage } from "../features/patients/RegisterPatientPage";
import { TodayQueuePage } from "../features/visits/TodayQueuePage";
import { VisitDetailPage } from "../features/visits/VisitDetailPage";
import { hasRole } from "../rbac/access";
import { ROLES, type Role } from "../rbac/roles";

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
  /** Navigation label. Entries without one (detail and form pages) are routed but not listed in the nav. */
  label?: string;
  roles: readonly Role[];
  Component: ComponentType;
}

export const featureRoutes: readonly FeatureRoute[] = [
  // GET /visits/today is open to any role, but only reception and owner see every status (§3.4).
  { path: "visits/today", label: "Today’s queue", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: TodayQueuePage },
  // GET /visits/:id is open to any role; the actions on it are reception's and owner's (§3.2).
  { path: "visits/:visitId", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: VisitDetailPage },
  // GET /patients is open to any role; registering (POST /patients) is reception only.
  { path: "patients", label: "Patients", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: PatientSearchPage },
  { path: "patients/new", roles: [ROLES.RECEPTION], Component: RegisterPatientPage },
  // GET /patients/:id and /:id/visits are open to any role; creating a visit (POST /visits) is reception only.
  { path: "patients/:patientId", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: PatientDetailPage },
];

export function navItemsFor(user: { role: string } | null): readonly (FeatureRoute & { label: string })[] {
  return featureRoutes.filter(
    (route): route is FeatureRoute & { label: string } => route.label !== undefined && hasRole(user, ...route.roles)
  );
}
