/**
 * Creates the first owner account on a fresh production database.
 * Production never runs db/seed.ts (it creates demo accounts with a
 * shared password); this is the only bootstrap path.
 *
 * Interactive only: it prompts for the username, full name and password
 * (typed twice, never echoed) so the password never lands in shell
 * history, process lists or compose files. Refuses an existing username.
 * Uses the app's own validation (CreateUserSchema), hashing and insert
 * (users.service createUser) and writes the same user.create audit entry
 * as POST /api/v1/users, with no acting user since nobody is signed in.
 *
 * Usage (production): docker compose ... exec api node dist/scripts/createOwner.js
 * Usage (development): npx tsx src/scripts/createOwner.ts
 */
import readline from "node:readline";
import { Writable } from "node:stream";
import { pool } from "../config/db";
import { CreateUserSchema } from "../modules/users/users.schema";
import { createUser } from "../modules/users/users.service";
import { ROLES } from "../modules/roles/roles";
import { recordAudit } from "../utils/audit";

/** Stricter than the app's 8-character minimum: this is the most privileged account. */
const MIN_OWNER_PASSWORD_LENGTH = 12;

let muted = false;
// readline echoes typed characters through `output`; muting it hides the password.
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
// Lines are buffered, so input that arrives before a prompt is not lost.
const lines = rl[Symbol.asyncIterator]();

async function ask(prompt: string, hidden = false): Promise<string> {
  process.stdout.write(prompt);
  muted = hidden;
  const next = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  if (next.done) throw new Error("Input ended before all answers were given.");
  return next.value;
}

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

async function main() {
  if (!process.stdin.isTTY) {
    fail("run this in an interactive terminal (docker compose exec allocates one; do not pipe input or use -T).");
  }

  console.log("Create the first owner account for WithUnion Clinic.\n");

  const username = (await ask("Username: ")).trim();
  const taken = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
  if ((taken.rowCount ?? 0) > 0) fail(`a user named "${username}" already exists. Nothing was changed.`);

  const fullName = (await ask("Full name: ")).trim();
  const password = await ask(`Password (at least ${MIN_OWNER_PASSWORD_LENGTH} characters, hidden): `, true);
  if (password.length < MIN_OWNER_PASSWORD_LENGTH) {
    fail(`the password must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters. Nothing was changed.`);
  }
  const confirm = await ask("Repeat the password: ", true);
  if (confirm !== password) fail("the passwords do not match. Nothing was changed.");

  const input = CreateUserSchema.safeParse({ fullName, username, password, role: ROLES.OWNER });
  if (!input.success) {
    const problems = Object.values(input.error.flatten().fieldErrors).flat();
    fail(`${problems.join("; ")}. Nothing was changed.`);
  }

  // createUser re-checks the username and turns a concurrent duplicate into an error.
  const user = await createUser(input.data);
  await recordAudit({
    userId: null,
    action: "user.create",
    entity: "users",
    entityId: user.id,
    afterValue: { fullName: user.fullName, username: user.username, role: user.role, createdVia: "createOwner script" },
    ipAddress: null,
  });

  console.log(`\nCreated owner "${user.username}" (${user.fullName}). Sign in at the clinic's web address.`);
}

main()
  .catch((err) => fail(err instanceof Error ? err.message : String(err)))
  .finally(async () => {
    rl.close();
    await pool.end();
  });
