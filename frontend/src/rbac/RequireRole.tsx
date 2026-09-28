import { Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { Forbidden } from "./Forbidden";
import { decideRoleGuard } from "./guards";
import type { Role } from "./roles";

/**
 * Route element for a role-protected branch. Must sit inside
 * RequireAuth. A disallowed role sees Forbidden in place of the page —
 * not a redirect — so the URL still says where they tried to go.
 */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const auth = useAuth();
  return decideRoleGuard(auth, roles) === "allow" ? <Outlet /> : <Forbidden />;
}
