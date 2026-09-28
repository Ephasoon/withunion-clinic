import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isSessionExpiredError } from "./authState";
import { authKeys, resetSessionCache } from "./queries";

/**
 * Why the user was last signed out — decides the login page notice and whether to return them to their page.
 * "logout-failed": the user signed out, but POST /auth/logout failed, so the session may still be live on the server.
 */
export type SignOutReason = "logout" | "logout-failed" | "expired" | null;

export interface AuthSessionContextValue {
  signOutReason: SignOutReason;
  setSignOutReason: (reason: SignOutReason) => void;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

/**
 * Holds the only client-side auth state that is not server state (why
 * the user was signed out) and turns any 401 UNAUTHENTICATED from any
 * query or mutation into a sign-out. That 401 is how the frontend
 * learns the backend deleted the session — expiry after 8 h, or an
 * owner changing this user's role, deactivating them, or resetting
 * their password.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signOutReason, setSignOutReasonState] = useState<SignOutReason>(null);
  const setSignOutReason = useCallback((reason: SignOutReason) => setSignOutReasonState(reason), []);

  useEffect(() => {
    const handleError = (error: unknown) => {
      if (!isSessionExpiredError(error)) return;
      // Only an authenticated session can expire. /auth/me's own 401
      // resolves to null rather than erroring, and logout handles its
      // own 401, so this does not fire for either.
      if (!queryClient.getQueryData(authKeys.me)) return;
      setSignOutReasonState("expired");
      resetSessionCache(queryClient, null);
    };

    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") handleError(event.action.error);
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") handleError(event.action.error);
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ signOutReason, setSignOutReason }), [signOutReason, setSignOutReason]);
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}
