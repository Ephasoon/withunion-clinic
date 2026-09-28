import { api } from "../../api";
import type { CreateUserBody, UpdateUserBody, User } from "./types";

const userPath = (userId: string) => `/api/v1/users/${encodeURIComponent(userId)}`;

/** GET /users → { users } — owner only; every user incl. inactive, by fullName, no pagination. */
export async function fetchUsers(signal?: AbortSignal): Promise<User[]> {
  const { users } = await api.get<{ users: User[] }>("/api/v1/users", { signal });
  return users;
}

/** GET /users/:id → { user }. */
export async function fetchUser(userId: string, signal?: AbortSignal): Promise<User> {
  const { user } = await api.get<{ user: User }>(userPath(userId), { signal });
  return user;
}

/** POST /users { fullName, username, password, role } → 201 { user } (created active). */
export async function createUser(body: CreateUserBody): Promise<User> {
  const { user } = await api.post<{ user: User }>("/api/v1/users", {
    fullName: body.fullName,
    username: body.username,
    password: body.password,
    role: body.role,
  });
  return user;
}

/** PATCH /users/:id with only the changed fields → { user }. A role change or deactivation ends the target's sessions. */
export async function updateUser(userId: string, body: UpdateUserBody): Promise<User> {
  const { user } = await api.patch<{ user: User }>(userPath(userId), body);
  return user;
}

/** POST /users/:id/reset-password { newPassword } → { user }. Ends ALL the target's sessions — including the caller's, if it is themselves. */
export async function resetUserPassword(userId: string, newPassword: string): Promise<User> {
  const { user } = await api.post<{ user: User }>(`${userPath(userId)}/reset-password`, { newPassword });
  return user;
}
