import pino from "pino";
import { env } from "./env";

/**
 * Structured logger. In development this pretty-prints; in
 * production it emits JSON lines suitable for a log shipper.
 * Never log passwords, session tokens, or full request bodies for
 * auth endpoints — see middleware/requestLogger.ts for redaction.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "req.body.password",
      "req.body.newPassword",
      "req.body.currentPassword",
    ],
    censor: "[redacted]",
  },
});
