/**
 * The session snapshot the backend stores at login and returns from
 * POST /auth/login and GET /auth/me (docs/api-inventory.md §4 AuthUser).
 * `role` is typed as string rather than Role so that a role this build
 * does not know about is carried through and handled (it fails closed
 * in rbac/access.ts) instead of being silently mistyped.
 */
export interface AuthUser {
  id: string;
  fullName: string;
  username: string;
  role: string;
  isActive: boolean;
}

/** Body of POST /api/v1/auth/login (LoginSchema: username 1–100, password 1–200 chars). */
export interface LoginInput {
  username: string;
  password: string;
}

export const LOGIN_LIMITS = { usernameMax: 100, passwordMax: 200 } as const;
