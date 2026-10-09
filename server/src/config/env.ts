import "dotenv/config";
import { z } from "zod";

/**
 * All environment variables are validated here, once, at boot.
 * Nothing else in the app should read process.env directly —
 * import `env` instead. This keeps missing/malformed config from
 * surfacing as a confusing runtime error deep in some module.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 characters"),
  SESSION_COOKIE_NAME: z.string().default("wu_clinic_sid"),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(8 * 60 * 60 * 1000),

  // Optional here so production can tell "missing" from "defaulted"
  // (see the refinement below); development falls back to Vite's origin.
  CORS_ORIGIN: z.string().min(1).optional(),

  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

   LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", 
"trace"]).default("info"),

  CLINIC_NAME: z.string().default("WithUnion Clinic"),
  CLINIC_ADDRESS: z.string().default(""),
  CLINIC_PHONE: z.string().default(""),
});

/** The placeholder in server/.env.example — never a usable secret. */
const EXAMPLE_SESSION_SECRET = "replace-this-with-a-long-random-value";

/**
 * Production must not boot on development fallbacks: CORS_ORIGIN has to
 * be set explicitly, and SESSION_SECRET must be a real, long secret
 * rather than the .env.example placeholder.
 */
const ProductionEnvSchema = EnvSchema.superRefine((e, ctx) => {
  if (e.NODE_ENV !== "production") return;
  if (!e.CORS_ORIGIN) {
    ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: "CORS_ORIGIN is required in production" });
  }
  if (e.SESSION_SECRET === EXAMPLE_SESSION_SECRET || e.SESSION_SECRET.length < 32) {
    ctx.addIssue({
      code: "custom",
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET must be a random value of at least 32 characters in production",
    });
  }
}).transform((e) => ({ ...e, CORS_ORIGIN: e.CORS_ORIGIN ?? "http://localhost:5173" }));

/** Validates a set of environment variables; exported for tests. */
export function parseEnv(source: NodeJS.ProcessEnv) {
  return ProductionEnvSchema.safeParse(source);
}

const parsed = parseEnv(process.env);

if (!parsed.success) {
  // Fail fast and loud at boot — never partially start with bad config.
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
