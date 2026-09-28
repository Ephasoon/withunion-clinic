import { useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { login, logout } from "./authApi";
import { AuthSessionContext, type AuthSessionContextValue, type SignOutReason } from "./AuthProvider";
import { deriveAuthState, signOutReasonForLogoutError, type AuthState } from "./authState";
import { authKeys, meQueryOptions, resetSessionCache } from "./queries";

/** The current auth state: loading, authenticated (with the user), unauthenticated, or error. */
export function useAuth(): AuthState {
  const query = useQuery(meQueryOptions);
  return deriveAuthState(query);
}

export function useAuthSession(): AuthSessionContextValue {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error("useAuthSession must be used inside <AuthProvider>");
  return value;
}

/** Re-runs the startup /auth/me check (used after it failed with a network or server error). */
export function useRetryAuthCheck(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.resetQueries({ queryKey: authKeys.me });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const { setSignOutReason } = useAuthSession();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      setSignOutReason(null);
      resetSessionCache(queryClient, user);
    },
  });
}

/**
 * Ends the session in this browser: records why, and clears the cached
 * user and every other cached query, so RequireAuth sends the user to
 * /login. The single local sign-out path — used by logout and by a
 * self password reset. Because the cached user is cleared first,
 * AuthProvider's 401 listener does not also treat it as an expiry.
 */
export function useSignOutLocally(): (reason: Exclude<SignOutReason, null>) => void {
  const queryClient = useQueryClient();
  const { setSignOutReason } = useAuthSession();
  return (reason) => {
    setSignOutReason(reason);
    resetSessionCache(queryClient, null);
  };
}

export function useLogout() {
  const signOutLocally = useSignOutLocally();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => signOutLocally("logout"),
    // Sign out locally whatever went wrong, so a shared workstation is
    // never left signed in; the reason tells the login page what happened.
    onError: (error) => signOutLocally(signOutReasonForLogoutError(error)),
  });
}
