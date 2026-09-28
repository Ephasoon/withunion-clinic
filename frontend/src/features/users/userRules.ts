import { ALL_ROLES, ROLES, type Role } from "../../rbac/roles";
import type { User } from "./types";

/** Active owners other than `excludeUserId`, counted from the loaded user list. */
export function countOtherActiveOwners(users: readonly Pick<User, "id" | "role" | "isActive">[], excludeUserId: string): number {
  return users.filter((u) => u.id !== excludeUserId && u.role === ROLES.OWNER && u.isActive).length;
}

/**
 * The backend's LAST_ACTIVE_OWNER rule (wouldRemoveLastActiveOwner in
 * users.service.ts), computed from the loaded list: a change is refused
 * only when the target is CURRENTLY an active owner, stops being one
 * (deactivated, demoted, or both), and no OTHER active owner exists.
 */
export function wouldRemoveLastActiveOwner(
  target: Pick<User, "id" | "role" | "isActive">,
  change: { role?: Role; isActive?: boolean },
  users: readonly Pick<User, "id" | "role" | "isActive">[]
): boolean {
  const wasActiveOwner = target.role === ROLES.OWNER && target.isActive;
  const staysActiveOwner = (change.role ?? target.role) === ROLES.OWNER && (change.isActive ?? target.isActive);
  if (!wasActiveOwner || staysActiveOwner) return false;
  return countOtherActiveOwners(users, target.id) === 0;
}

export interface EditConstraints {
  isSelf: boolean;
  /** Why deactivating is not offered, or null when it is. */
  deactivateBlockedReason: string | null;
  /** Roles that may be chosen; the current role is always included. */
  allowedRoles: Role[];
  /** Why other roles are not offered, or null when every role is. */
  roleBlockedReason: string | null;
}

/**
 * What the owner may change on `target`, decided BEFORE submitting so the
 * backend's SELF_DEACTIVATION_NOT_ALLOWED, SELF_DEMOTION_NOT_ALLOWED and
 * LAST_ACTIVE_OWNER are prevented rather than reported after the fact.
 * (Another owner acting at the same moment can still trigger them; the
 * page handles those errors too.)
 */
export function editConstraints(
  currentUserId: string,
  target: Pick<User, "id" | "role" | "isActive">,
  users: readonly Pick<User, "id" | "role" | "isActive">[]
): EditConstraints {
  const isSelf = target.id === currentUserId;

  if (isSelf) {
    return {
      isSelf,
      deactivateBlockedReason: "You can’t deactivate your own account.",
      allowedRoles: [ROLES.OWNER],
      roleBlockedReason: "You can’t change your own role away from Owner.",
    };
  }

  const lastOwner = wouldRemoveLastActiveOwner(target, { isActive: false }, users);
  const deactivateBlockedReason =
    target.isActive && lastOwner ? "This is the only active Owner. Another active Owner is needed first." : null;

  const demoteBlocked = wouldRemoveLastActiveOwner(target, { role: ROLES.PHARMACY }, users);
  return {
    isSelf,
    deactivateBlockedReason,
    allowedRoles: demoteBlocked ? [ROLES.OWNER] : [...ALL_ROLES],
    roleBlockedReason: demoteBlocked ? "This is the only active Owner, so the role can’t be changed." : null,
  };
}

/** docs §5.2: username trimmed, 1–100 chars, letters, numbers, '.', '_', '-' only. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const USERNAME_MAX = 100;
export const FULL_NAME_MAX = 255;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function validateUsername(raw: string): string | null {
  const username = raw.trim();
  if (username === "") return "Enter a username.";
  if (username.length > USERNAME_MAX) return `Keep the username under ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) return "Use only letters, numbers, dots, underscores and hyphens — no spaces.";
  return null;
}

/** 8–200 characters. Not trimmed — the backend doesn't trim passwords either. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function validateFullName(raw: string): string | null {
  const fullName = raw.trim();
  if (fullName === "") return "Enter the full name.";
  if (fullName.length > FULL_NAME_MAX) return `Keep the name under ${FULL_NAME_MAX} characters.`;
  return null;
}

export interface CreateUserValues {
  fullName: string;
  username: string;
  password: string;
  role: Role | "";
}

export type CreateUserErrors = Partial<Record<keyof CreateUserValues, string>>;

export function validateCreateUser(
  values: CreateUserValues
): { ok: true; body: { fullName: string; username: string; password: string; role: Role } } | { ok: false; errors: CreateUserErrors } {
  const errors: CreateUserErrors = {};
  const fullNameError = validateFullName(values.fullName);
  if (fullNameError) errors.fullName = fullNameError;
  const usernameError = validateUsername(values.username);
  if (usernameError) errors.username = usernameError;
  const passwordError = validatePassword(values.password);
  if (passwordError) errors.password = passwordError;
  if (!(ALL_ROLES as readonly string[]).includes(values.role)) errors.role = "Choose a role.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      fullName: values.fullName.trim(),
      username: values.username.trim(),
      password: values.password,
      role: values.role as Role,
    },
  };
}

/**
 * PATCH /users/:id body with only what changed. The backend requires at
 * least one field (a refine with no path, so its error has no field
 * details), so "nothing changed" is caught here with a clear message.
 */
export function buildUserPatch(
  original: Pick<User, "fullName" | "role" | "isActive">,
  draft: { fullName: string; role: Role; isActive: boolean }
): { ok: true; body: { fullName?: string; role?: Role; isActive?: boolean } } | { ok: false; error: string } {
  const fullNameError = validateFullName(draft.fullName);
  if (fullNameError) return { ok: false, error: fullNameError };
  const body: { fullName?: string; role?: Role; isActive?: boolean } = {};
  if (draft.fullName.trim() !== original.fullName) body.fullName = draft.fullName.trim();
  if (draft.role !== original.role) body.role = draft.role;
  if (draft.isActive !== original.isActive) body.isActive = draft.isActive;
  if (Object.keys(body).length === 0) return { ok: false, error: "Change at least one field (name, role or active status) before saving." };
  return { ok: true, body };
}

/**
 * Whether a saved change ends the target's sessions: a role change or a
 * deactivation deletes them (docs §5.2); a name edit or reactivation does not.
 */
export function changeEndsSessions(
  original: Pick<User, "role" | "isActive">,
  body: { role?: Role; isActive?: boolean }
): boolean {
  return (body.role !== undefined && body.role !== original.role) || (body.isActive === false && original.isActive);
}
