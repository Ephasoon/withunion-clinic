import { describe, it, expect } from "vitest";
import { parseEnv } from "../src/config/env";

const REAL_SECRET = "a".repeat(48);

function base(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { DATABASE_URL: "postgres://u:p@db:5432/x", SESSION_SECRET: REAL_SECRET, ...overrides };
}

function errorsFor(result: ReturnType<typeof parseEnv>, key: string): string[] {
  if (result.success) return [];
  const fieldErrors: Record<string, string[] | undefined> = result.error.flatten().fieldErrors;
  return fieldErrors[key] ?? [];
}

describe("parseEnv — production fail-fast", () => {
  it("refuses to start in production without CORS_ORIGIN", () => {
    const result = parseEnv(base({ NODE_ENV: "production" }));
    expect(result.success).toBe(false);
    expect(errorsFor(result, "CORS_ORIGIN")).toEqual(["CORS_ORIGIN is required in production"]);
  });

  it("refuses the .env.example placeholder secret in production", () => {
    const result = parseEnv(
      base({ NODE_ENV: "production", CORS_ORIGIN: "https://clinic.example", SESSION_SECRET: "replace-this-with-a-long-random-value" })
    );
    expect(result.success).toBe(false);
    expect(errorsFor(result, "SESSION_SECRET")).toHaveLength(1);
  });

  it("refuses a production SESSION_SECRET shorter than 32 characters", () => {
    const result = parseEnv(base({ NODE_ENV: "production", CORS_ORIGIN: "https://clinic.example", SESSION_SECRET: "x".repeat(31) }));
    expect(result.success).toBe(false);
    expect(errorsFor(result, "SESSION_SECRET")).toHaveLength(1);
  });

  it("refuses a missing SESSION_SECRET in any environment", () => {
    const result = parseEnv(base({ NODE_ENV: "production", CORS_ORIGIN: "https://clinic.example", SESSION_SECRET: undefined }));
    expect(result.success).toBe(false);
    expect(errorsFor(result, "SESSION_SECRET").length).toBeGreaterThan(0);
  });

  it("accepts a complete production configuration and keeps CORS_ORIGIN as given", () => {
    const result = parseEnv(base({ NODE_ENV: "production", CORS_ORIGIN: "https://clinic.example" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.CORS_ORIGIN).toBe("https://clinic.example");
  });

  it("still defaults CORS_ORIGIN to the Vite dev origin outside production", () => {
    const result = parseEnv(base({ NODE_ENV: "development", SESSION_SECRET: "sixteen-chars-ok" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.CORS_ORIGIN).toBe("http://localhost:5173");
  });
});
