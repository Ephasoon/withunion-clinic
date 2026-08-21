import { defineConfig } from "vitest/config";

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
      LOGIN_RATE_LIMIT_MAX: "1000",
    },
  },
});
