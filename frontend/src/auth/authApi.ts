import { api } from "../api";
import { isSessionExpiredError } from "./authState";
import type { AuthUser, LoginInput } from "./types";

/**
 * GET /api/v1/auth/me → { data: { user: AuthUser } }.
 * A 401 UNAUTHENTICATED is the normal "no session" answer, so it
 * resolves to null instead of throwing. Any other failure (network,
 * 5xx) still throws — "could not check" is not "signed out".
 */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const { user } = await api.get<{ user: AuthUser }>("/api/v1/auth/me", { signal });
    return user;
  } catch (error) {
    if (isSessionExpiredError(error)) return null;
    throw error;
  }
}

/**
 * POST /api/v1/auth/login with { username, password } → { data: { user: AuthUser } }
 * plus the session Set-Cookie. Wrong credentials throw ApiError 401
 * INVALID_CREDENTIALS; too many attempts throw 429 RATE_LIMITED.
 */
export async function login(input: LoginInput): Promise<AuthUser> {
  const { user } = await api.post<{ user: AuthUser }>("/api/v1/auth/login", {
    username: input.username,
    password: input.password,
  });
  return user;
}

/** POST /api/v1/auth/logout (no body) → { data: { loggedOut: true } }; the backend destroys the session and clears the cookie. */
export async function logout(): Promise<void> {
  await api.post<{ loggedOut: true }>("/api/v1/auth/logout");
}
