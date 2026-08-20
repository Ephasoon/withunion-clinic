/**
 * Roles are data-driven (stored in the `roles` table), but we also
 * keep a typed constant list here so route guards and tests get
 * autocomplete/compile-time checking instead of raw strings.
 *
 * If a 7th role is ever added, add it here AND seed it in the
 * `roles` table migration — the two must stay in sync.
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

export const ALL_ROLES: Role[] = Object.values(ROLES);

/**
 * Permission keys used by the requireRole/requirePermission middleware.
 * This is intentionally coarse-grained for the foundation phase —
 * clinical modules (Phase 3+) will add their own permission keys as
 * they're built, following this same pattern.
 */
export const PERMISSIONS = {
  MANAGE_USERS: "manage_users",
  VIEW_AUDIT_LOG: "view_audit_log",
  VIEW_DASHBOARD: "view_dashboard",
  MANAGE_INVENTORY_ADJUSTMENTS: "manage_inventory_adjustments", // owner only
  OPERATE_INVENTORY: "operate_inventory", // pharmacy: receive/dispense
  COLLECT_PAYMENT: "collect_payment", // reception only — sole cashier role
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Role → permission map. This is the single source of truth the
 * RBAC middleware consults. Corrections from Phase 1 review are
 * encoded directly here:
 *  - only RECEPTION has COLLECT_PAYMENT (pharmacy never collects payment)
 *  - only OWNER has MANAGE_INVENTORY_ADJUSTMENTS (write-offs/adjustments)
 *  - PHARMACY has OPERATE_INVENTORY (receive/dispense) but not adjustments
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.OWNER]: [
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.MANAGE_INVENTORY_ADJUSTMENTS,
  ],
  [ROLES.RECEPTION]: [PERMISSIONS.COLLECT_PAYMENT],
  [ROLES.NURSE]: [],
  [ROLES.DOCTOR]: [],
  [ROLES.LAB_TECH]: [],
  [ROLES.PHARMACY]: [PERMISSIONS.OPERATE_INVENTORY],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Visit queue transition table — corrected per Phase 1 review.
 * Each role may only fire the transitions listed under it. This is
 * consumed by the (Phase 3) visit-transition endpoint; it lives here
 * now so the RBAC foundation and its tests can already assert the
 * rule "no role can act outside its own step."
 */
export const QUEUE_TRANSITIONS: Record<Role, Array<{ from: string; to: string }>> = {
  [ROLES.RECEPTION]: [
    { from: "__new__", to: "REGISTERED" },
    { from: "REGISTERED", to: "WAITING_FOR_NURSE" },
    { from: "REGISTERED", to: "WAITING_FOR_DOCTOR" }, // explicit nurse-skip
    { from: "WAITING_FOR_BILLING", to: "COMPLETED" },
    { from: "*", to: "CANCELLED" },
  ],
  [ROLES.NURSE]: [
    { from: "WAITING_FOR_NURSE", to: "WITH_NURSE" },
    { from: "WITH_NURSE", to: "WAITING_FOR_DOCTOR" },
  ],
  [ROLES.DOCTOR]: [
    { from: "WAITING_FOR_DOCTOR", to: "WITH_DOCTOR" },
    { from: "WITH_DOCTOR", to: "WAITING_FOR_LAB" },
    { from: "LAB_COMPLETED", to: "WITH_DOCTOR" },
    { from: "WITH_DOCTOR", to: "WAITING_FOR_PHARMACY" },
    { from: "WITH_DOCTOR", to: "WAITING_FOR_BILLING" },
  ],
  [ROLES.LAB_TECH]: [
    { from: "WAITING_FOR_LAB", to: "AT_LAB" },
    { from: "AT_LAB", to: "LAB_COMPLETED" },
  ],
  [ROLES.PHARMACY]: [
    { from: "WAITING_FOR_PHARMACY", to: "AT_PHARMACY" },
    { from: "AT_PHARMACY", to: "WAITING_FOR_BILLING" },
  ],
  [ROLES.OWNER]: [{ from: "*", to: "CANCELLED" }],
};

export function canTransition(role: Role, from: string, to: string): boolean {
  const allowed = QUEUE_TRANSITIONS[role] ?? [];
  return allowed.some((t) => (t.from === "*" || t.from === from) && t.to === to);
}
