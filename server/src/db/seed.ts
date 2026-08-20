/**
 * Development seed data ONLY. Creates one demo account per role so
 * the auth/RBAC foundation can be exercised end-to-end. Never run
 * this against production. Passwords are intentionally simple demo
 * values — change them (or don't seed at all) before going live.
 *
 * Usage: npx tsx src/db/seed.ts
 */
import { pool } from "../config/db";
import { hashPassword } from "../modules/auth/auth.service";
import { logger } from "../config/logger";

const DEMO_USERS = [
  { fullName: "Demo Owner", username: "owner.demo", role: "owner" },
  { fullName: "Demo Receptionist", username: "reception.demo", role: "reception" },
  { fullName: "Demo Nurse", username: "nurse.demo", role: "nurse" },
  { fullName: "Demo Doctor A", username: "doctor.a.demo", role: "doctor" },
  { fullName: "Demo Doctor B", username: "doctor.b.demo", role: "doctor" },
  { fullName: "Demo Lab Tech", username: "lab.demo", role: "lab_tech" },
  { fullName: "Demo Pharmacy Worker", username: "pharmacy.demo", role: "pharmacy" },
] as const;

const DEMO_PASSWORD = "ChangeMe123!";

async function seed() {
  for (const u of DEMO_USERS) {
    const roleResult = await pool.query("SELECT id FROM roles WHERE name = $1", [u.role]);
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      logger.warn(`Role "${u.role}" not found — did migrations run?`);
      continue;
    }

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [u.username]);
    if (existing.rows.length > 0) {
      logger.info(`Skipping ${u.username} — already exists`);
      continue;
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await pool.query(
      `INSERT INTO users (full_name, username, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [u.fullName, u.username, passwordHash, roleId]
    );
    logger.info(`Created demo user ${u.username} (${u.role})`);
  }

  logger.info(`Done. Demo password for all seeded accounts: ${DEMO_PASSWORD}`);
  await pool.end();
}

seed().catch((err) => {
  logger.error(err, "Seed failed");
  process.exit(1);
});
