import { Navigate, Outlet, useLocation } from "react-router";
import { FullPageStatus } from "../components/FullPageStatus";
import { AuthCheckFailed } from "./AuthCheckFailed";
import { decideGuestGuard, safeRedirectPath } from "./guards";
import { useAuth } from "./useAuth";

/** Route element for the login area. Once signed in, sends the user on to where they were going. */
export function GuestOnly() {
  const auth = useAuth();
  const location = useLocation();

  switch (decideGuestGuard(auth)) {
    case "wait":
      return <FullPageStatus message="Checking your session…" />;
    case "error":
      return <AuthCheckFailed />;
    case "redirect": {
      const from = (location.state as { from?: unknown } | null)?.from;
      return <Navigate to={safeRedirectPath(from)} replace />;
    }
    case "allow":
      return <Outlet />;
  }
}
