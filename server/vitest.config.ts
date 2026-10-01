import "dotenv/config";
import { defineConfig } from "vitest/config";

// Tests create and delete data freely, so they must never touch the dev
// database. DATABASE_URL is overridden below; the app's own
// `import "dotenv/config"` never overrides an already-set variable.
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error("TEST_DATABASE_URL is not set — refusing to run tests against the dev database.");
}
const testDbName = new URL(testDbUrl).pathname.slice(1);
if (!testDbName.endsWith("_test")) {
  throw new Error(`TEST_DATABASE_URL must point at a *_test database (got "${testDbName}").`);
}

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
    setupFiles: [],
    // Login is rate-limited (10/15min) by design for production abuse
    // protection — see server/src/modules/auth/auth.routes.ts. The
    // test suite legitimately logs in far more often than that in a
    // single run, so it gets its own generous limit here rather than
    // loosening the production default.
    env: {
      DATABASE_URL: testDbUrl,
      LOGIN_RATE_LIMIT_MAX: "1000",
    },
  },
});
