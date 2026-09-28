import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { fetchCurrentUser } from "./authApi";
import type { AuthUser } from "./types";

export const authKeys = {
  all: ["auth"] as const,
  me: ["auth", "me"] as const,
};

/**
 * The session user. Fetched once at startup; after that it only
 * changes through login, logout, or a 401 elsewhere (see AuthProvider),
 * so it never goes stale on its own. The backend snapshot does not
 * change during a session either (docs/api-inventory.md §2).
 */
export const meQueryOptions = queryOptions({
  queryKey: authKeys.me,
  queryFn: ({ signal }) => fetchCurrentUser(signal),
  staleTime: Infinity,
  gcTime: Infinity,
});

/**
 * Switches the cached session to `user` (null = signed out) and drops
 * every other cached query and mutation, so nothing fetched for one
 * user is ever shown to the next one on a shared clinic workstation.
 */
export function resetSessionCache(queryClient: QueryClient, user: AuthUser | null): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authKeys.all[0] });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(authKeys.me, user);
}
