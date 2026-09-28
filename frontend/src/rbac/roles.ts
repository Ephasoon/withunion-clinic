/**
 * Frontend mirror of the backend's roles (server/src/modules/roles/roles.ts).
 * Used only to decide what the UI shows — the backend's requireRole()
 * checks on every route remain the actual security boundary.
 *
 * The backend also defines a ROLE_PERMISSIONS map, but no route
 * enforces it (every route uses requireRole with an explicit role list),
 * so it is deliberately not mirrored here.
 */
export const ROLES = {
  OWNER: "owner",
  RECEPTION: "reception",
  NURSE: "nurse",
  DOCTOR: "doctor",
  LAB_TECH: "lab_tech",
  PHARMACY: "pharmacy",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  reception: "Reception",
  nurse: "Nurse",
  doctor: "Doctor",
  lab_tech: "Lab technician",
  pharmacy: "Pharmacy",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

/** Display label for a role string; falls back to the raw value for a role this build does not know. */
export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}
