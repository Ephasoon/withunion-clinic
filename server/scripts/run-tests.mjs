/**
 * `npm test` runner. The suite shares one PostgreSQL database, so two
 * kinds of test file can't run alongside the others:
 *  - dashboard.test.ts / reports.test.ts assert on whole-table counts,
 *    which other files' concurrent writes throw off;
 *  - users.test.ts temporarily deactivates every other owner account
 *    (including test.owner), so other files' owner logins fail meanwhile.
 * Two passes:
 *  1. every other test file, in parallel (as before);
 *  2. those files, one at a time, after pass 1 has finished.
 * Pass 2 ALWAYS runs, even if pass 1 fails, so every run reports both.
 * Exits non-zero if either pass failed (the worse code if both did).
 *
 * Extra arguments are not forwarded — to run a single file, use
 * `npx vitest run tests/<file>.test.ts` directly.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitestCli = join(serverDir, "node_modules", "vitest", "vitest.mjs");

const ISOLATED_FILES = ["tests/dashboard.test.ts", "tests/reports.test.ts", "tests/users.test.ts"];

if (process.argv.length > 2) {
  console.warn(
    `run-tests: ignoring arguments (${process.argv.slice(2).join(" ")}). ` +
      "To run one file, use: npx vitest run tests/<file>.test.ts"
  );
}

function runPass(label, args) {
  console.log(`\n===== ${label}: vitest ${args.join(" ")} =====\n`);
  // stdio "inherit" streams vitest's output live; no shell, so the
  // same invocation works on Windows and POSIX.
  const result = spawnSync(process.execPath, [vitestCli, ...args], { cwd: serverDir, stdio: "inherit" });
  if (result.error) {
    console.error(`run-tests: failed to start ${label}:`, result.error);
    return 1;
  }
  // A null status means the child was killed by a signal — a failure.
  return result.status ?? 1;
}

const pass1 = runPass(
  "Pass 1 (parallel)",
  ["run", ...ISOLATED_FILES.flatMap((file) => ["--exclude", file])]
);
const pass2 = runPass("Pass 2 (isolated, sequential)", ["run", ...ISOLATED_FILES, "--no-file-parallelism"]);

const status = (code) => (code === 0 ? "passed" : `FAILED (exit ${code})`);
console.log(`\n===== run-tests summary: pass 1 ${status(pass1)}, pass 2 ${status(pass2)} =====`);

process.exit(Math.max(pass1, pass2));
