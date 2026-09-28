import { Navigate, Outlet, useLocation } from "react-router";
import { FullPageStatus } from "../components/FullPageStatus";
import { AuthCheckFailed } from "./AuthCheckFailed";
import { decideAuthGuard, LOGIN_PATH } from "./guards";
import { useAuth, useAuthSession } from "./useAuth";

/**
 * Route element for the authenticated area. Signed-out users go to
 * /login; unless they just signed out on purpose, the page they asked
 * for is remembered so they return to it after signing in.
 */
export function RequireAuth() {
  const auth = useAuth();
  const { signOutReason } = useAuthSession();
  const location = useLocation();

  switch (decideAuthGuard(auth)) {
    case "wait":
      return <FullPageStatus message="Checking your session…" />;
    case "error":
      return <AuthCheckFailed />;
    case "redirect":
      return (
        <Navigate
          to={LOGIN_PATH}
          replace
          state={signOutReason === "logout" ? undefined : { from: location }}
        />
      );
    case "allow":
      return <Outlet />;
  }
}
