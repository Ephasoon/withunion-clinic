import bcrypt from "bcrypt";
import { pool } from "../../config/db";
import { Role } from "../roles/roles";

const BCRYPT_ROUNDS = 12;

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
}

interface UserRow {
  id: string;
  full_name: string;
  username: string;
  password_hash: string;
  is_active: boolean;
  role_name: Role;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Looks up a user by username, joined to their role name.
 * Returns null if no such user exists — callers must not reveal
 * whether the failure was "no such user" vs "wrong password".
 */
export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT u.id, u.full_name, u.username, u.password_hash, u.is_active, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.username = $1`,
    [username]
  );
  return result.rows[0] ?? null;
}

export function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    role: row.role_name,
    isActive: row.is_active,
  };
}

/**
 * Full login attempt: looks up the user, checks active status, and
 * verifies the password. Deliberately returns a single generic
 * failure reason to the caller's caller (the route) to avoid
 * leaking which part failed — see auth.controller.ts.
 */
export async function attemptLogin(
  username: string,
  plainPassword: string
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; reason: "invalid" | "inactive" }> {
  const row = await findUserByUsername(username);
  if (!row) return { ok: false, reason: "invalid" };
  if (!row.is_active) return { ok: false, reason: "inactive" };

  const passwordOk = await verifyPassword(plainPassword, row.password_hash);
  if (!passwordOk) return { ok: false, reason: "invalid" };

  return { ok: true, user: toAuthenticatedUser(row) };
}
