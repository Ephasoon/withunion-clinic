import { useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { login, logout } from "./authApi";
import { AuthSessionContext, type AuthSessionContextValue } from "./AuthProvider";
import { deriveAuthState, isSessionExpiredError, type AuthState } from "./authState";
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

export function useLogout() {
  const queryClient = useQueryClient();
  const { setSignOutReason } = useAuthSession();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setSignOutReason("logout");
      resetSessionCache(queryClient, null);
    },
    onError: (error) => {
      // The session was already gone server-side: the user is signed out either way.
      if (isSessionExpiredError(error)) {
        setSignOutReason("logout");
        resetSessionCache(queryClient, null);
      }
    },
  });
}
