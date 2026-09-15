import { Pool, PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { hashPassword } from "../auth/auth.service";
import { ROLES, Role } from "../roles/roles";
import { CreateUserInput, UpdateUserInput } from "./users.schema";

export interface User {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const USER_SELECT = `
  SELECT u.id, u.full_name, u.username, r.name AS role, u.is_active, u.created_at, u.updated_at
  FROM users u
  JOIN roles r ON r.id = u.role_id
`;

export async function listUsers(): Promise<User[]> {
  const result = await pool.query<UserRow>(`${USER_SELECT} ORDER BY u.full_name`);
  return result.rows.map(toUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/**
 * Deletes every stored session belonging to a specific user. Sessions
 * are Postgres-backed (connect-pg-simple), storing the session
 * payload as JSON in the `sess` column with the cached user snapshot
 * under `sess.user`. Since requireAuth/requireRole only ever read
 * that cached snapshot (never re-querying `users` per request), this
 * is the only way to make a role change, deactivation, or password
 * reset take effect before a session's natural ~8h expiry. Scoped
 * strictly to the one user id — never touches any other session.
 */
async function invalidateUserSessions(executor: Pool | PoolClient, userId: string): Promise<void> {
  await executor.query(`DELETE FROM session WHERE sess->'user'->>'id' = $1`, [userId]);
}

/**
 * Checks whether applying the given effective role/isActive to
 * targetUserId would leave the system with zero active Owners. Only
 * relevant when the target user is CURRENTLY an active Owner and the
 * change would remove that status (deactivation, demotion, or both).
 * If they weren't an active Owner before the change, this is always
 * a no-op — changing a non-owner's role, or activating someone,
 * never reduces the active-Owner count.
 */
async function wouldRemoveLastActiveOwner(
  client: PoolClient,
  targetUserId: string,
  currentRole: Role,
  currentIsActive: boolean,
  effectiveRole: Role,
  effectiveIsActive: boolean
): Promise<boolean> {
  const wasActiveOwner = currentRole === ROLES.OWNER && currentIsActive;
  const staysActiveOwner = effectiveRole === ROLES.OWNER && effectiveIsActive;
  if (!wasActiveOwner || staysActiveOwner) {
    return false;
  }

  const result = await client.query(
    `SELECT 1
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1
     LIMIT 1`,
    [targetUserId]
  );
  return (result.rowCount ?? 0) === 0;
}

/**
 * Owner-only user creation. Duplicate-username handling mirrors the
 * pharmacy_inventory_items precedent: a fast pre-check for the
 * common case, plus a catch around the insert converting a raw
 * Postgres unique-violation (23505) into the same clean 409, so a
 * race between two concurrent creates never surfaces as a 500.
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const existing = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [input.username]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new AppError(409, "USERNAME_ALREADY_EXISTS", `Username "${input.username}" is already in use`);
  }

  const roleResult = await pool.query<{ id: number }>(`SELECT id FROM roles WHERE name = $1`, [input.role]);
  const roleId = roleResult.rows[0]?.id;
  if (!roleId) {
    throw new AppError(400, "VALIDATION_ERROR", `Unknown role "${input.role}"`);
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (full_name, username, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [input.fullName, input.username, passwordHash, roleId]
    );
    return (await getUserById(result.rows[0].id))!;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      throw new AppError(409, "USERNAME_ALREADY_EXISTS", `Username "${input.username}" is already in use`);
    }
    throw err;
  }
}

export interface UpdateUserOutcome {
  user: User;
  roleChanged: boolean;
  wasDeactivated: boolean; // isActive transitioned true -> false
}

/**
 * Updates fullName/role/isActive, enforcing (in order):
 *  - self-deactivation is never allowed;
 *  - self-demotion (away from Owner) is never allowed;
 *  - no update may leave the system with zero active Owners.
 * Whenever the role actually changes or the user is deactivated, the
 * update and the session-invalidation DELETE run in ONE transaction —
 * so a session can never survive a change that was supposed to
 * invalidate it, and a failed invalidation can never leave a stale
 * role/status change committed on its own.
 */
export async function updateUser(
  targetUserId: string,
  requestingUserId: string,
  input: UpdateUserInput
): Promise<UpdateUserOutcome> {
  const target = await getUserById(targetUserId);
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const isSelf = targetUserId === requestingUserId;

  if (isSelf && input.isActive === false) {
    throw new AppError(409, "SELF_DEACTIVATION_NOT_ALLOWED", "You cannot deactivate your own account");
  }
  if (isSelf && input.role !== undefined && input.role !== ROLES.OWNER) {
    throw new AppError(409, "SELF_DEMOTION_NOT_ALLOWED", "You cannot change your own role away from Owner");
  }

  const effectiveRole = input.role ?? target.role;
  const effectiveIsActive = input.isActive ?? target.isActive;
  const roleChanged = input.role !== undefined && input.role !== target.role;
  const wasDeactivated = input.isActive === false && target.isActive === true;

  return withTransaction(async (client: PoolClient) => {
    if (
      await wouldRemoveLastActiveOwner(
        client,
        targetUserId,
        target.role,
        target.isActive,
        effectiveRole,
        effectiveIsActive
      )
    ) {
      throw new AppError(
        409,
        "LAST_ACTIVE_OWNER",
        "This change would leave the system with no active Owner account"
      );
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (input.fullName !== undefined) {
      fields.push(`full_name = $${i++}`);
      values.push(input.fullName);
    }
    if (input.role !== undefined) {
      const roleResult = await client.query<{ id: number }>(`SELECT id FROM roles WHERE name = $1`, [input.role]);
      const roleId = roleResult.rows[0]?.id;
      if (!roleId) {
        throw new AppError(400, "VALIDATION_ERROR", `Unknown role "${input.role}"`);
      }
      fields.push(`role_id = $${i++}`);
      values.push(roleId);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(input.isActive);
    }
    fields.push(`updated_at = now()`);
    values.push(targetUserId);

    await client.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i}`, values);

    // Session invalidation trigger: role actually changed, or the
    // user was just deactivated. A plain fullName edit, or
    // reactivation, does not invalidate sessions (nothing to revoke).
    if (roleChanged || wasDeactivated) {
      await invalidateUserSessions(client, targetUserId);
    }

    const updated = await client.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [targetUserId]);
    return { user: toUser(updated.rows[0]), roleChanged, wasDeactivated };
  });
}

/**
 * Owner-only password reset. Hashes the new password with the
 * existing hashPassword(), then invalidates every session the target
 * user currently holds, in the same transaction as the password
 * write, so a reset can never leave an old session usable.
 */
export async function resetPassword(targetUserId: string, newPassword: string): Promise<User> {
  const target = await getUserById(targetUserId);
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const passwordHash = await hashPassword(newPassword);

  return withTransaction(async (client: PoolClient) => {
    await client.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
      passwordHash,
      targetUserId,
    ]);
    await invalidateUserSessions(client, targetUserId);

    const updated = await client.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [targetUserId]);
    return toUser(updated.rows[0]);
  });
}
