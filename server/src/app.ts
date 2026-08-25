import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { env } from "./config/env";
import { pool, healthCheck } from "./config/db";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { patientsRouter } from "./modules/patients/patients.routes";
import { visitsRouter } from "./modules/visits/visits.routes";

const PgSession = connectPgSimple(session);

export function createApp(): Express {
  const app = express();

  // Trust the Nginx reverse proxy for correct req.ip / secure-cookie
  // detection in production (Phase 1 §28 infrastructure).
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  app.use(
    session({
      store: new PgSession({ pool, tableName: "session" }),
      name: env.SESSION_COOKIE_NAME,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: env.SESSION_MAX_AGE_MS,
      },
    })
  );

  app.get("/health", async (_req, res) => {
    const dbOk = await healthCheck();
    res.status(dbOk ? 200 : 503).json({
      data: { status: dbOk ? "ok" : "degraded", database: dbOk },
      error: null,
      meta: null,
    });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/patients", patientsRouter);
  app.use("/api/v1/visits", visitsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
