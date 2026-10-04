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
import { nursingRouter } from "./modules/nursing/nursing.routes";
import { consultationRouter } from "./modules/consultation/consultation.routes";
import { laboratoryRouter, laboratoryVisitReadsRouter } from "./modules/laboratory/laboratory.routes";
import { pharmacyRouter, pharmacyVisitReadsRouter } from "./modules/pharmacy/pharmacy.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { billingRouter, billingVisitReadsRouter } from "./modules/billing/billing.routes";
import { auditLogRouter } from "./modules/audit-log/audit-log.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { purchasesRouter } from "./modules/purchases/purchases.routes";
import { receiptsRouter } from "./modules/receipts/receipts.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { priceListRouter } from "./modules/price-list/price-list.routes";
import { chargeLinksRouter } from "./modules/charge-links/charge-links.routes";

const PgSession = connectPgSimple(session);

export function createApp(): Express {
  const app = express();

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
  app.use("/api/v1/visits", nursingRouter);
  // Visit-scoped reads owned by other modules (a visit page reads everything from /visits/:id/...).
  app.use("/api/v1/visits", laboratoryVisitReadsRouter);
  app.use("/api/v1/visits", pharmacyVisitReadsRouter);
  app.use("/api/v1/visits", billingVisitReadsRouter);
  app.use("/api/v1", consultationRouter);
  app.use("/api/v1/laboratory", laboratoryRouter);
  app.use("/api/v1/pharmacy", pharmacyRouter);
  app.use("/api/v1/inventory", inventoryRouter);
  app.use("/api/v1/billing", billingRouter);
  app.use("/api/v1/audit-logs", auditLogRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/suppliers", suppliersRouter);
  app.use("/api/v1/purchases", purchasesRouter);
  app.use("/api/v1/receipts", receiptsRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/price-list", priceListRouter);
  app.use("/api/v1/charge-links", chargeLinksRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
