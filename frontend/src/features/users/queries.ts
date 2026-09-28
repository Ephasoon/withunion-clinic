import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignOutLocally } from "../../auth/useAuth";
import { createUser, fetchUser, fetchUsers, resetUserPassword, updateUser } from "./api";
import type { CreateUserBody, UpdateUserBody } from "./types";

export const userKeys = {
  list: ["users", "list"] as const,
  detail: (userId: string) => ["users", "detail", userId] as const,
};

export function useUsers() {
  return useQuery({ queryKey: userKeys.list, queryFn: ({ signal }) => fetchUsers(signal) });
}

export function useUser(userId: string) {
  return useQuery({ queryKey: userKeys.detail(userId), queryFn: ({ signal }) => fetchUser(userId, signal) });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return (userId?: string) => {
    void queryClient.invalidateQueries({ queryKey: userKeys.list });
    if (userId) void queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: CreateUserBody) => createUser(body),
    onSettled: (user) => invalidate(user?.id),
  });
}

export function useUpdateUser(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: UpdateUserBody) => updateUser(userId, body),
    onSettled: () => invalidate(userId),
  });
}

/**
 * POST /users/:id/reset-password. Resetting one's OWN password deletes the
 * session this app is using, so on success the app signs itself out at
 * once through the same path as logout (useSignOutLocally), with a clear
 * "password changed" message — instead of waiting for the next request to
 * fail with a 401 that AuthProvider would report as an expired session.
 * This hook-level onSuccess runs before onSettled, so the cached user is
 * already cleared before any refetch could hit that 401.
 */
export function useResetPassword(userId: string, isSelf: boolean) {
  const invalidate = useInvalidateUsers();
  const signOutLocally = useSignOutLocally();
  return useMutation({
    mutationFn: (newPassword: string) => resetUserPassword(userId, newPassword),
    onSuccess: () => {
      if (isSelf) signOutLocally("password-changed");
    },
    onSettled: () => invalidate(userId),
  });
}
