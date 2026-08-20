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

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud at boot — never partially start with bad config.
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
