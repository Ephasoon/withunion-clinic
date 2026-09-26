import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateQuery } from "../../middleware/validate";
import {
  VisitsReportQuerySchema,
  FinancialReportQuerySchema,
  PurchasingReportQuerySchema,
  PharmacyDispensingReportQuerySchema,
  VisitsReportQuery,
  FinancialReportQuery,
  PurchasingReportQuery,
  PharmacyDispensingReportQuery,
} from "./reports.schema";
import {
  getVisitsReport,
  getFinancialReport,
  getPurchasingReport,
  getPharmacyDispensingReport,
} from "./reports.service";
import { ROLES } from "../roles/roles";

export const reportsRouter = Router();

reportsRouter.get(
  "/visits",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateQuery(VisitsReportQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: VisitsReportQuery }).validatedQuery;
      const report = await getVisitsReport(query);
      res.json({ data: { report }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

reportsRouter.get(
  "/financial",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateQuery(FinancialReportQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: FinancialReportQuery }).validatedQuery;
      const report = await getFinancialReport(query);
      res.json({ data: { report }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

reportsRouter.get(
  "/purchasing",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateQuery(PurchasingReportQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: PurchasingReportQuery }).validatedQuery;
      const report = await getPurchasingReport(query);
      res.json({ data: { report }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

reportsRouter.get(
  "/pharmacy-dispensing",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateQuery(PharmacyDispensingReportQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: PharmacyDispensingReportQuery }).validatedQuery;
      const report = await getPharmacyDispensingReport(query);
      res.json({ data: { report }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
