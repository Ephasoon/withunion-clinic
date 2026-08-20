import { pool } from "../src/config/db";
import { hashPassword } from "../src/modules/auth/auth.service";

export const TEST_PASSWORD = "TestPass123!";

/**
 * Assumes migrations have already been run against the test
 * database (DATABASE_URL should point at a disposable test DB —
 * see package.json test script / CI setup). Inserts one active and
 * one deactivated user per relevant role for the test suite.
 */
export async function seedTestUsers() {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  async function upsertUser(username: string, fullName: string, role: string, isActive: boolean) {
    const roleRow = await pool.query("SELECT id FROM roles WHERE name = $1", [role]);
    const roleId = roleRow.rows[0].id;
    await pool.query(
      `INSERT INTO users (full_name, username, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET is_active = $5`,
      [fullName, username, passwordHash, roleId, isActive]
    );
  }

  await upsertUser("test.owner", "Test Owner", "owner", true);
  await upsertUser("test.reception", "Test Reception", "reception", true);
  await upsertUser("test.pharmacy", "Test Pharmacy", "pharmacy", true);
  await upsertUser("test.inactive", "Test Inactive", "nurse", false);
}

export async function closeTestPool() {
  await pool.end();
}
