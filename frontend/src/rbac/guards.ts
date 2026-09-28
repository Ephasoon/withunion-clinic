import type { AuthState } from "../auth/authState";
import { isRoleAllowed } from "./access";
import type { Role } from "./roles";

export type RoleGuardDecision = "allow" | "forbidden";

/**
 * Decision for a role-protected route. Only meaningful inside the
 * authenticated area (RequireAuth has already handled every other
 * auth state), so anything but an allowed, authenticated user is
 * "forbidden".
 */
export function decideRoleGuard(state: AuthState, allowed: readonly Role[]): RoleGuardDecision {
  if (state.status === "authenticated" && isRoleAllowed(state.user.role, allowed)) return "allow";
  return "forbidden";
}
